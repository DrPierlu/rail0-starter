import { defineTool } from "eve/tools";
import { z } from "zod";
import { getShop } from "../../src/lib/buyer";
import { shopBase } from "../lib/base";

export default defineTool({
  description: "Fetch an order's current state (refreshes the on-chain payment status).",
  inputSchema: z.object({
    order_id: z.string().describe("The order id (or its rail0_id)."),
  }),
  execute: ({ order_id }) => getShop(shopBase()).order(order_id),
});
