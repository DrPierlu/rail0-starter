import { describe, expect, it } from "vitest";
import { type CheckoutEvent, pendingSignature } from "@/lib/checkout-step";

const none = new Set<string>();

// The bug this pins: signedKeys is component state, the transcript is restored from
// sessionStorage. Relying on the set alone made every already-signed step look unsigned
// after a reload — the docked box offered to sign a payment the transcript showed as
// already submitted and confirming.
describe("pendingSignature", () => {
  it("owes the last unsigned signature", () => {
    const events: CheckoutEvent[] = [
      { kind: "signing", key: "sign_login:abc", orderId: "abc" },
      { kind: "signing", key: "sign_payment:abc", orderId: "abc" },
    ];
    expect(pendingSignature(events, none)).toEqual({ key: "sign_payment:abc", orderId: "abc" });
  });

  it("owes nothing once this tab signed it", () => {
    const events: CheckoutEvent[] = [{ kind: "signing", key: "sign_payment:abc", orderId: "abc" }];
    expect(pendingSignature(events, new Set(["sign_payment:abc"]))).toBeNull();
  });

  // The reload case, and the reason the transcript is the authority: an empty signedKeys
  // must not resurrect a signature the conversation clearly moved past.
  it("owes nothing when the transcript moved past it, even with no memory of signing", () => {
    const events: CheckoutEvent[] = [
      { kind: "signing", key: "sign_payment:abc", orderId: "abc" },
      { kind: "order", orderId: "abc" },
    ];
    expect(pendingSignature(events, none)).toBeNull();
  });

  it("is not cleared by another order's activity", () => {
    const events: CheckoutEvent[] = [
      { kind: "signing", key: "sign_payment:abc", orderId: "abc" },
      { kind: "order", orderId: "zzz" },
    ];
    expect(pendingSignature(events, none)).toEqual({ key: "sign_payment:abc", orderId: "abc" });
  });

  // Order matters: reading an order's state BEFORE the signing step (the buyer asking
  // about it while the agent prepares) must not pre-clear the signature.
  it("only counts order activity that comes after", () => {
    const events: CheckoutEvent[] = [
      { kind: "order", orderId: "abc" },
      { kind: "signing", key: "sign_payment:abc", orderId: "abc" },
    ];
    expect(pendingSignature(events, none)).toEqual({ key: "sign_payment:abc", orderId: "abc" });
  });

  // A re-prepare after a failed submit: the signature is owed again.
  it("owes it again when a new signing step follows the order activity", () => {
    const events: CheckoutEvent[] = [
      { kind: "signing", key: "sign_payment:abc", orderId: "abc" },
      { kind: "order", orderId: "abc" },
      { kind: "signing", key: "sign_payment:abc", orderId: "abc" },
    ];
    expect(pendingSignature(events, none)).toEqual({ key: "sign_payment:abc", orderId: "abc" });
  });

  it("owes nothing for an empty transcript", () => {
    expect(pendingSignature([], none)).toBeNull();
  });
});
