import { defineTool } from "eve/tools";
import { z } from "zod";
import { beginCheckout, checkoutAsAgent } from "../../src/lib/buyer";
import {
  agentWalletAddress,
  autonomousOrderLimit,
  withinAutonomousLimit,
} from "../../src/lib/buyer-signer";
import { shopBase } from "../lib/base";
import { cartTotal, getCart } from "../lib/cart";
import { rememberOrder } from "../lib/orders";

export default defineTool({
  // The shopper approves the checkout before it starts. Until now the rule lived only in
  // instructions ("ALWAYS ask the user to confirm"), which the model may decline to
  // follow — evals/checkout/confirms-before-spending.eval.ts says so in as many words.
  // The docs are explicit that an omitted `approval` means calls may execute with no
  // human at all, and that financial and external side-effecting actions must not be left
  // there (docs/tools/human-in-the-loop.md). The client half was already built: the buyer
  // UI renders `approval-requested` parts (src/app/buyer/eve-tool-view.tsx).
  //
  // THIS step and not the later ones. With a HUMAN buyer the wallet already gates the
  // MONEY — nothing moves without their SIWE and EIP-3009 signatures — so an approval on
  // checkout_submit would only re-ask about a payment they had just signed. What no
  // signature covers is INTENT: this call creates the merchant-side order and mints the
  // deposit nonce before any wallet prompt appears. The signature says "I authorise this
  // payment"; the approval says "I asked for this order".
  //
  // With an AGENT WALLET that reasoning collapses: the agent produces both signatures, so
  // nothing else asks anyone anything and this approval is the only gate on spending.
  // Which is why it is now a decision rather than a constant — under the ceiling the
  // agent buys unattended (the point of configuring a key at all), over it a person is
  // asked. Not a refusal: an approved escalation still buys, autonomously.
  //
  // Never once(): it would auto-allow every later checkout in the session, which on
  // spending is exactly the wrong default. Anything unexpected — a cart that cannot be
  // read, a total that will not parse — asks, because the safe answer to "how much is
  // this?" being unavailable is not "go ahead".
  async approval() {
    try {
      // Inside the try, not before it: reading the wallet parses the whole environment
      // schema, so a deployment missing an unrelated variable would throw here — and an
      // approval policy that throws is not a policy. Everything unreadable lands on the
      // same answer, which is to ask.
      if (!agentWalletAddress()) return "user-approval";
      return withinAutonomousLimit(cartTotal(await getCart()), autonomousOrderLimit())
        ? "approved"
        : "user-approval";
    } catch {
      return "user-approval";
    }
  },
  description:
    "Start the checkout for the current cart. With an agent wallet configured this runs " +
    "the whole checkout and returns the finished order. Otherwise it creates the order " +
    "and the sign-in challenge: STOP and wait — the user signs in the card shown in chat.",
  inputSchema: z.object({
    chain_id: z.number().int().describe("Chosen chain id, from payment_options."),
    token_address: z
      .string()
      .describe("Chosen stablecoin's contract address, from payment_options."),
    // Optional because the agent's own wallet needs no address from anywhere: it buys as
    // itself. Required in practice for a human buyer, and refused below when missing —
    // in the schema it would make the autonomous path demand an address that does not
    // exist.
    buyer_address: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional()
      .describe("The connected wallet address, exactly as given in the client context."),
  }),
  async execute({ chain_id, token_address, buyer_address }) {
    const cart = await getCart();
    if (cart.length === 0) return { error: "cart is empty" };
    const items = cart.map((l) => ({ product_id: l.product_id, qty: l.qty }));

    // The agent's own wallet: no cards, no waiting, no second and third tool call.
    // Approval has already run by the time we are here, so reaching this line means the
    // spend is allowed — either it was under the ceiling or a human said yes.
    if (agentWalletAddress()) {
      const { order, rail0_id } = await checkoutAsAgent(shopBase(), items, chain_id, token_address);
      await rememberOrder(order.id);
      return {
        step: "done" as const,
        order_id: order.id,
        total: order.total,
        token: order.token.symbol,
        state: order.state,
        rail0_id,
      };
    }

    if (!buyer_address) {
      return { error: "no wallet connected — ask the shopper to connect one, then retry" };
    }

    const { order, siwe_message, deposit_nonce } = await beginCheckout(
      shopBase(),
      items,
      chain_id,
      token_address,
      buyer_address,
    );
    // The buyer's own record of the order, so `my_orders` never needs the
    // merchant's (now gated) order book.
    await rememberOrder(order.id);
    // deposit_nonce rides the tool output because that is how the signing card is
    // handed everything else it needs (the card reads part.output verbatim, not the
    // model's retelling of it). It is what the card must present to deposit the
    // signature — see SigningEntry.deposit_nonce.
    return {
      step: "sign_login",
      order_id: order.id,
      total: order.total,
      token: order.token.symbol,
      siwe_message,
      deposit_nonce,
    };
  },
  // What the MODEL sees. The card still gets the full return — toModelOutput "only
  // affects the model. Channel event handlers and hooks still get the full output on
  // action.result" (docs/tools/overview.mdx).
  //
  // So the deposit nonce and the SIWE text never enter model context or the durable model
  // history. The nonce is a capability: it is what lets a signature be deposited for this
  // checkout, and it was previously kept out of replies by a prompt rule ("never repeat
  // it") — the model being asked not to say a secret it was handed. The docs name this
  // exact case: "Do not return secrets, credentials, unnecessary personal data, or
  // unbounded sensitive content from tools. Filter, minimize, and redact tool outputs
  // before returning them."
  //
  // The model only needs to know which step it is on and what to tell the user.
  toModelOutput(output) {
    if ("error" in output) return { type: "json", value: { error: output.error } };
    // The autonomous run is already finished, so telling the model to wait for a card
    // that will never appear is the one thing that would break it: it would sit there
    // asking the shopper to sign something nobody has to sign.
    if (output.step === "done") {
      return {
        type: "json",
        value: {
          step: output.step,
          order_id: output.order_id,
          total: output.total,
          token: output.token,
          state: output.state,
          next: "paid from the agent wallet; poll order_status for the escrow to confirm",
        },
      };
    }
    return {
      type: "json",
      value: {
        step: output.step,
        order_id: output.order_id,
        total: output.total,
        token: output.token,
        awaiting: "the user signs the sign-in card shown in chat",
      },
    };
  },
});
