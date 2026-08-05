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
});
