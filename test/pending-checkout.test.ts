import { describe, expect, it } from "vitest";
import { HISTORY_KEY, readHistory, rememberChat, type StorageLike } from "@/lib/chat-history";
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

/**
 * The double purchase of 2026-08-18, pinned end to end.
 *
 * A buyer paid, hopped to /merchant to capture, and came back. Resuming restored the
 * TRANSCRIPT but not the set of checkouts already paid, and the agent's order_status had
 * not landed yet — so the transcript carried no proof either, the docked box offered the
 * same checkout again, and the card creates a NEW payment every time it runs. Two
 * escrows, same tee, 85 seconds apart.
 *
 * The set travels with the transcript now; this is the round trip through storage that
 * proves it, since the fix is worth nothing if the write and the read disagree.
 */
describe("a checkout paid before the chat was resumed", () => {
  const KEY = "checkout:ck_9f2";
  // The transcript as it stands in that gap: the checkout happened, nothing followed it.
  const events: CheckoutEvent[] = [{ kind: "checkout", key: KEY }];

  it("is still owed when the completed set does not survive the resume", () => {
    // The regression itself, kept as a test so the shape cannot come back unnoticed.
    expect(pendingCheckout(events, new Set())).toEqual({ key: KEY });
  });

  it("is not owed once the set travels with the transcript", () => {
    const storage = new Map<string, string>();
    const store: StorageLike = {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => void storage.set(k, v),
      removeItem: (k) => void storage.delete(k),
    };

    rememberChat(store, {
      id: "session-1",
      savedAt: 1,
      title: "buy me a tee",
      events: [],
      completed: [KEY],
    });

    const [restored] = readHistory(store);
    expect(pendingCheckout(events, new Set(restored.completed ?? []))).toBeNull();
  });

  it("reads a record written before the field existed as nothing paid", () => {
    // Records already in a browser have no `completed`. They must not crash, and the
    // transcript stays the authority for them — which is the pre-existing behaviour.
    const storage = new Map<string, string>([
      [HISTORY_KEY, JSON.stringify([{ id: "old", savedAt: 1, title: "t", events: [] }])],
    ]);
    const store: StorageLike = {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => void storage.set(k, v),
      removeItem: (k) => void storage.delete(k),
    };
    expect(readHistory(store)[0].completed).toEqual([]);
  });
});
