import { defineTool } from "eve/tools";
import { z } from "zod";
import { getShop } from "../../src/lib/buyer";
import { shopBase } from "../lib/base";
import { rememberOrder } from "../lib/orders";

export default defineTool({
  description: "Fetch an order's current state, live from the rail0 gateway.",
  inputSchema: z.object({
    order_id: z.string().describe("The order's rail0 payment id (0x… 64 hex)."),
  }),
  async execute({ order_id }) {
    const result = await getShop(shopBase()).order(order_id);
    // Where a HUMAN buyer's orders enter this session's list. The autonomous path can
    // remember its order at checkout because it has one by then; the browser path only
    // learns the id when the card finishes and tells the agent, and this is the call the
    // agent makes with it. A read that succeeded is proof the order exists, which is all
    // `my_orders` needs to list it.
    await rememberOrder(result.order.id);
    return result;
  },
});
