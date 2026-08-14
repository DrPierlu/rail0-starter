import { describe, expect, it } from "vitest";
import { CHECKOUT_STEPS, currentStep, stepIndex } from "@/lib/checkout-step";

// The panel shows ONE action at a time, so the precedence between "the card is waiting
// for your signature" and "the order is confirming" has to be unambiguous — for the
// first two steps there is no order at all, and after them there is one whose state
// says nothing about what the buyer still has to do.
describe("currentStep", () => {
  it("asks for the wallet before the signature it is needed for", () => {
    expect(currentStep({ hasWallet: false, awaitingSignature: "sign_login" })).toBe("connect");
    expect(currentStep({ hasWallet: false, awaitingSignature: "sign_payment" })).toBe("connect");
  });

  it("names the awaited signature once a wallet is connected", () => {
    expect(currentStep({ hasWallet: true, awaitingSignature: "sign_login" })).toBe("sign_login");
    expect(currentStep({ hasWallet: true, awaitingSignature: "sign_payment" })).toBe(
      "sign_payment",
    );
  });

  // The precedence that matters: the payment exists from step 2 onwards, so reading its
  // state first would report "confirming" while the buyer still has to sign it.
  it("puts an awaited signature ahead of the order state", () => {
    expect(
      currentStep({
        hasWallet: true,
        awaitingSignature: "sign_payment",
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
