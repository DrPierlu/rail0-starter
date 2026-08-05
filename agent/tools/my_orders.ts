import { defineTool } from "eve/tools";
import { z } from "zod";
import { getShop } from "../../src/lib/buyer";
import { shopBase } from "../lib/base";
import { myOrderIds } from "../lib/orders";

export default defineTool({
  description: "List the orders placed in this conversation, newest first, with their state.",
  inputSchema: z.object({}),
  async execute() {
    const ids = await myOrderIds();
    const shop = getShop(shopBase());
    // allSettled, and drop the failures: one order the merchant no longer knows
    // (a wiped demo store, a gateway hiccup on its refresh) must not turn the
    // whole list into an error.
    const results = await Promise.allSettled(ids.map((id) => shop.order(id)));
    return {
      orders: results.flatMap((r) => (r.status === "fulfilled" ? [r.value.order] : [])),
    };
  },
});
