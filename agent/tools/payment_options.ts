import { defineTool } from "eve/tools";
import { z } from "zod";
import { getShop } from "../../src/lib/buyer";
import { shopBase } from "../lib/base";

export default defineTool({
  description: "List the chain + stablecoin pairs the merchant accepts (from the rail0 gateway).",
  inputSchema: z.object({}),
  execute: () => getShop(shopBase()).paymentMethods(),
});
