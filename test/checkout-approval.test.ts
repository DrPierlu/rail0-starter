import { describe, expect, it } from "vitest";
import checkoutBegin from "../agent/tools/checkout_begin";
import checkoutPayment from "../agent/tools/checkout_payment";
import checkoutSubmit from "../agent/tools/checkout_submit";

/**
 * The approval on checkout_begin is a one-line property that is easy to drop in a
 * refactor, and its absence is invisible: the agent keeps working, it just stops asking.
 * Same reasoning as evals/harness-is-locked-down.eval.ts for the disabled tools — except
 * an approval policy is a property of the harness, not a behaviour of the model, so it
 * belongs in a deterministic test rather than an eval that spends a model call to observe
 * it (and could only observe it on a run that reaches checkout, which needs a wallet).
 */
describe("checkout approval", () => {
  it("gates checkout_begin on a human, on every call", () => {
    // A policy is a function eve calls per tool call: always() answers
    // "user-approval", never() answers "not-applicable". Asserting the ANSWER rather
    // than the helper's name is what makes this test mean something — twice, because
    // once() would concede after the first checkout and that is the failure to catch.
    const policy = checkoutBegin.approval as unknown as () => string;

    expect(policy).toBeTypeOf("function");
    expect(policy()).toBe("user-approval");
    expect(policy()).toBe("user-approval");
  });

  // Not an oversight: the money is already gated by the wallet at these steps, and an
  // approval here would ask the shopper to confirm a payment they have just signed. If a
  // later change makes either of them move funds WITHOUT a fresh signature, this
  // expectation is the one that should be revisited first.
  it("leaves the signature-gated steps unguarded on purpose", () => {
    expect(checkoutPayment.approval).toBeUndefined();
    expect(checkoutSubmit.approval).toBeUndefined();
  });
});
