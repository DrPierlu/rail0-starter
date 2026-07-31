import { defineTool } from "eve/tools";
import { z } from "zod";
import { submitSignedPayment } from "../../src/lib/buyer";
import { clearCart } from "../../src/lib/store";
import { shopBase } from "../lib/base";

export default defineTool({
  description:
    "Checkout step 3, only after the user confirmed they signed the payment: " +
    "submits the signed payment — the funds move into on-chain escrow.",
  inputSchema: z.object({
    order_id: z.string().describe("The order id from checkout_begin."),
  }),
  async execute({ order_id }) {
    const { order, rail0_id } = await submitSignedPayment(shopBase(), order_id);
    await clearCart();
    return {
      order_id: order.id,
      state: order.state,
      total: order.total,
      token: order.token.symbol,
      rail0_id,
    };
  },
});
