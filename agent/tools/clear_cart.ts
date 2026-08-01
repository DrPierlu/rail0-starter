import { defineTool } from "eve/tools";
import { z } from "zod";
import { clearCart } from "../lib/cart";

export default defineTool({
  description: "Empty the cart entirely.",
  inputSchema: z.object({}),
  async execute() {
    await clearCart();
    return { cart: [] };
  },
});
