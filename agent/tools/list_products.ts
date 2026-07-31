import { defineTool } from "eve/tools";
import { z } from "zod";
import { getShop } from "../../src/lib/buyer";
import { shopBase } from "../lib/base";

export default defineTool({
  description: "List the merchant's products, optionally filtered by category or free-text search.",
  inputSchema: z.object({
    category: z.string().optional(),
    search: z.string().optional(),
  }),
  execute: (input) => getShop(shopBase()).products(input),
});
