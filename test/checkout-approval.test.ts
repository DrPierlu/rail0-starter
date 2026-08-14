import { describe, expect, it } from "vitest";
import checkoutBegin from "../agent/tools/checkout_begin";
import orderStatus from "../agent/tools/order_status";

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

  // checkout_begin is now the ONLY tool that can spend, which is what makes the gate
  // above the whole gate. The human checkout runs in the card from here on (it holds the
  // signatures), and the autonomous one runs inside this same call — so there is no
  // second money-moving tool that could quietly bypass the approval. A read is a read.
  it("leaves the read-only tools unguarded", () => {
    expect(orderStatus.approval).toBeUndefined();
  });
});
