import { defineTool } from "eve/tools";
import { z } from "zod";
import { beginCheckout } from "../../src/lib/buyer";
import { shopBase } from "../lib/base";
import { getCart } from "../lib/cart";
import { rememberOrder } from "../lib/orders";

export default defineTool({
  description:
    "Start the checkout for the current cart: creates the order and the sign-in " +
    "challenge. The user's wallet address comes from the client context. After " +
    "calling this, STOP and wait — the user signs in the card shown in chat.",
  inputSchema: z.object({
    chain_id: z.number().int().describe("Chosen chain id, from payment_options."),
    token_address: z
      .string()
      .describe("Chosen stablecoin's contract address, from payment_options."),
    buyer_address: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .describe("The connected wallet address, exactly as given in the client context."),
  }),
  async execute({ chain_id, token_address, buyer_address }) {
    const cart = await getCart();
    if (cart.length === 0) return { error: "cart is empty" };
    const { order, siwe_message, deposit_nonce } = await beginCheckout(
      shopBase(),
      cart.map((l) => ({ product_id: l.product_id, qty: l.qty })),
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
