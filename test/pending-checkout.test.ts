import { describe, expect, it } from "vitest";
import { type CheckoutEvent, pendingCheckout } from "@/lib/checkout-step";

const none = new Set<string>();

// The bug this pins: the finished-checkout set is component state, the transcript is
// restored from sessionStorage. Relying on the set alone made a finished checkout look
// unfinished after a reload — the docked box offered to sign a payment the transcript
// showed as already submitted and confirming.
describe("pendingCheckout", () => {
  it("owes the last unfinished checkout", () => {
    const events: CheckoutEvent[] = [
      { kind: "checkout", key: "checkout:aaa" },
      { kind: "checkout", key: "checkout:bbb" },
    ];
    expect(pendingCheckout(events, none)).toEqual({ key: "checkout:bbb" });
  });

  it("owes nothing once this tab finished it", () => {
    const events: CheckoutEvent[] = [{ kind: "checkout", key: "checkout:aaa" }];
    expect(pendingCheckout(events, new Set(["checkout:aaa"]))).toBeNull();
  });

  // The reload case, and the reason the transcript is the authority: an empty set must
  // not resurrect a checkout the conversation clearly moved past. An order can only
  // exist because that checkout created it.
  it("owes nothing when an order followed it, even with no memory of finishing", () => {
    const events: CheckoutEvent[] = [
      { kind: "checkout", key: "checkout:aaa" },
      { kind: "order", orderId: "0xabc" },
    ];
    expect(pendingCheckout(events, none)).toBeNull();
  });

  // Order matters: reading an order's state BEFORE the checkout (the buyer asking about
  // an earlier purchase while the agent prepares this one) must not pre-clear it.
  it("only counts order activity that comes after", () => {
    const events: CheckoutEvent[] = [
      { kind: "order", orderId: "0xabc" },
      { kind: "checkout", key: "checkout:aaa" },
    ];
    expect(pendingCheckout(events, none)).toEqual({ key: "checkout:aaa" });
  });

  // A restart after a failed checkout: the new one is owed even though an order exists.
  it("owes a new checkout that follows the order activity", () => {
    const events: CheckoutEvent[] = [
      { kind: "checkout", key: "checkout:aaa" },
      { kind: "order", orderId: "0xabc" },
      { kind: "checkout", key: "checkout:bbb" },
    ];
    expect(pendingCheckout(events, none)).toEqual({ key: "checkout:bbb" });
  });

  it("owes nothing for an empty transcript", () => {
    expect(pendingCheckout([], none)).toBeNull();
  });
});
