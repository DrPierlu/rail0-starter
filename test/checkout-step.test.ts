import { describe, expect, it } from "vitest";
import { CHECKOUT_STEPS, currentStep, stepIndex } from "@/lib/checkout-step";

// The panel shows ONE action at a time, so the precedence between "you owe a signature"
// and "the order is confirming" has to be unambiguous — an order sits at
// awaiting_payment for the whole time the payer is signing.
describe("currentStep", () => {
  it("asks for the wallet before the signature it is needed for", () => {
    expect(currentStep({ hasWallet: false, pendingSigning: "sign_login" })).toBe("connect");
    expect(currentStep({ hasWallet: false, pendingSigning: "sign_payment" })).toBe("connect");
  });

  it("names the pending signature once a wallet is connected", () => {
    expect(currentStep({ hasWallet: true, pendingSigning: "sign_login" })).toBe("sign_login");
    expect(currentStep({ hasWallet: true, pendingSigning: "sign_payment" })).toBe("sign_payment");
  });

  // The precedence that matters: reading the order state first would report
  // "confirming" while the buyer still has something to do.
  it("puts a pending signature ahead of the order state", () => {
    expect(
      currentStep({
        hasWallet: true,
        pendingSigning: "sign_payment",
        orderState: "awaiting_payment",
      }),
    ).toBe("sign_payment");
  });

  it("is confirming while the order is in flight", () => {
    expect(currentStep({ hasWallet: true, orderState: "authorizing" })).toBe("confirming");
    expect(currentStep({ hasWallet: true, orderState: "in_escrow" })).toBe("confirming");
    expect(currentStep({ hasWallet: true, orderState: "capturing" })).toBe("confirming");
  });

  it("is done at every terminal state", () => {
    for (const state of ["settled", "cancelled", "failed"] as const) {
      expect(currentStep({ hasWallet: true, orderState: state })).toBe("done");
    }
  });

  // null is what hides the panel. Without it an empty box would sit above the composer
  // for the whole browsing part of the conversation.
  it("is null when there is no checkout in flight", () => {
    expect(currentStep({ hasWallet: false })).toBeNull();
    expect(currentStep({ hasWallet: true })).toBeNull();
  });
});

describe("stepIndex", () => {
  it("orders the row as the flow runs", () => {
    expect(CHECKOUT_STEPS.map(stepIndex)).toEqual([0, 1, 2, 3]);
  });

  // done sits past the last step so every one of them renders complete.
  it("puts done past the end", () => {
    expect(stepIndex("done")).toBe(CHECKOUT_STEPS.length);
  });
});
