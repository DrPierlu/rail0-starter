import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

/**
 * The catalog is English and the search matches per word, so a query passed through in the
 * shopper's own language found nothing — and the shopper watched the agent fail and retry
 * ("no matching products", then a second call that worked). Both halves of the fix are
 * model-facing (the tool description and an instruction), so only an eval can hold them.
 */
export default defineEval({
  description: "An Italian request finds products without a failed first attempt.",
  async test(t) {
    await t.send("cerco una maglietta a maniche corte");
    t.succeeded();
    t.calledTool("list_products");
    // One search, not a miss followed by a retry.
    t.maxToolCalls(2);
    // The catalog's own word for what it sells, so this fails if the search came back empty.
    t.check(t.reply, includes("Tee"));
  },
});
