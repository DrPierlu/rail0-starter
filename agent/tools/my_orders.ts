import { defineTool } from "eve/tools";
import { z } from "zod";
import { getShop } from "../../src/lib/buyer";
import { shopBase } from "../lib/base";

export default defineTool({
  description: "List all orders, newest first, with their current state.",
  inputSchema: z.object({}),
  execute: () => getShop(shopBase()).orders(),
});
