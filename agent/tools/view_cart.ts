import { defineTool } from "eve/tools";
import { z } from "zod";
import { getCart } from "../lib/cart";

export default defineTool({
  description: "Show the current cart contents.",
  inputSchema: z.object({}),
  async execute() {
    return { cart: await getCart() };
  },
});
