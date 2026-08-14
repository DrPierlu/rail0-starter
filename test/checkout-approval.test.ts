import { describe, expect, it } from "vitest";
import checkoutBegin from "../agent/tools/checkout_begin";
import checkoutPayment from "../agent/tools/checkout_payment";
import checkoutSubmit from "../agent/tools/checkout_submit";

/**
 * The approval on checkout_begin is a small property that is easy to drop in a refactor,
 * and its absence is invisible: the agent keeps working, it just stops asking. Same
 * reasoning as evals/harness-is-locked-down.eval.ts for the disabled tools — except an
 * approval policy is a property of the harness, not a behaviour of the model, so it
 * belongs in a deterministic test rather than an eval that spends a model call to observe
 * it (and could only observe it on a run that reaches checkout, which needs a wallet).
 *
 * It is now a decision rather than a constant (agent wallet + a total under the ceiling
 * buys unattended), so what this pins is the DEFAULT: with no agent wallet configured —
 * which is this test environment, and every deployment that has not opted in — every call
 * asks a human.
 */
describe("checkout approval", () => {
  it("gates checkout_begin on a human, on every call, with no agent wallet", async () => {
    // A policy is a function eve calls per tool call, and it may be async. Asserting the
    // ANSWER rather than the helper's name is what makes this test mean something —
    // twice, because once() would concede after the first checkout and that is the
    // failure to catch.
    const policy = checkoutBegin.approval as unknown as () => Promise<string>;

    expect(policy).toBeTypeOf("function");
    expect(await policy()).toBe("user-approval");
    expect(await policy()).toBe("user-approval");
  });

  it("asks rather than throwing when it cannot tell", async () => {
    // Reading the wallet parses the whole env schema, and this suite has none of it set:
    // the policy must answer, not raise. An approval that throws would take the tool call
    // down instead of asking — the failure mode with the worst shape, because it looks
    // like a bug in checkout rather than a missing decision.
    const policy = checkoutBegin.approval as unknown as () => Promise<string>;
    await expect(policy()).resolves.toBe("user-approval");
  });

  // Not an oversight: with a human buyer the money is already gated by the wallet at
  // these steps, and an approval here would ask the shopper to confirm a payment they
  // have just signed. The agent path does not reach them at all — checkout_begin runs the
  // whole checkout — so its spending gate is the one above, not these.
  it("leaves the signature-gated steps unguarded on purpose", () => {
    expect(checkoutPayment.approval).toBeUndefined();
    expect(checkoutSubmit.approval).toBeUndefined();
  });
});
