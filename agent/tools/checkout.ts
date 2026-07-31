import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { placeAndPayOrder } from "../../src/lib/buyer";
import { addressFor } from "../../src/lib/rail0";
import { clearCart, getCart } from "../../src/lib/store";
import { shopBase } from "../lib/base";

export default defineTool({
  description:
    "Place the order for the current cart and pay it over rail0 escrow. " +
    "Only call after the user explicitly confirmed cart, total, chain and token.",
  inputSchema: z.object({
    chain_id: z.number().int().describe("Chosen chain id, from payment_options."),
    token_address: z
      .string()
      .describe("Chosen stablecoin's contract address, from payment_options."),
  }),
  // eve replays interrupted steps, and checkout is the one tool that must not
  // run twice (it creates the order, signs the EIP-3009 payload and moves real
  // funds into escrow). The approval gate makes the human click the idempotency
  // barrier — exactly the safeguard the eve docs prescribe for charges.
  approval: always(),
  async execute({ chain_id, token_address }) {
    const cart = await getCart();
    if (cart.length === 0) return { error: "cart is empty" };
    const { order, rail0_id } = await placeAndPayOrder(
      shopBase(),
      cart.map((l) => ({ product_id: l.product_id, qty: l.qty })),
      chain_id,
      token_address,
    );
    await clearCart();
    return {
      order_id: order.id,
      state: order.state,
      total: order.total,
      token: order.token.symbol,
      rail0_id,
      payer: addressFor("buyer"),
    };
  },
});
