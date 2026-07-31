import { defineTool } from "eve/tools";
import { z } from "zod";
import { removeFromCart } from "../../src/lib/store";

export default defineTool({
  description: "Remove a product from the cart (all of it, or just `qty` units).",
  inputSchema: z.object({
    product_id: z.string(),
    qty: z.number().int().positive().optional(),
  }),
  async execute({ product_id, qty }) {
    return { cart: await removeFromCart(product_id, qty) };
  },
});
