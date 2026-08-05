import { defineEval } from "eve/evals";

/**
 * The checkout procedure moved out of the always-on prompt into `agent/skills/checkout.md`,
 * which is what the docs prescribe for "optional procedures that should not bloat every
 * turn". That trade only pays off if the routing works: a skill the model never loads is a
 * procedure it no longer has.
 */
export default defineEval({
  description: "When the shopper is ready to buy, the agent loads the checkout skill.",
  async test(t) {
    await t.send("Add a Slim-Fit Tee to my cart, then walk me through paying for it.");
    t.succeeded();
    t.loadedSkill("checkout");
  },
});
