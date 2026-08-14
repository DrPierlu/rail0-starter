import { describe, expect, it } from "vitest";
import { keepEscrowed } from "@/app/merchant/dashboard";
import type { Order } from "@/lib/order-view";

/**
 * The double-click window on real escrowed funds.
 *
 * Capture answers 202 as soon as it is broadcast, and the order list that follows still
 * reads `in_escrow` — the merchant's book comes from `GET /payments`, which carries no
 * transactions, so a capture being mined looks exactly like one never started. The
 * buttons therefore came back enabled seconds after the click. They now stay down until
 * the list itself stops calling the order escrowed, which is what this pins.
 */
const order = (id: string, state: Order["state"]) => ({ id, state });

describe("keepEscrowed", () => {
  it("holds the buttons down while the order still reads as escrowed", () => {
    const submitted = { "0xaaa": "capture" as const };
    expect(keepEscrowed(submitted, [order("0xaaa", "in_escrow")])).toEqual(submitted);
  });

  it("releases them once the order has moved on", () => {
    for (const state of ["capturing", "settled", "voiding", "cancelled", "failed"] as const) {
      expect(keepEscrowed({ "0xaaa": "capture" }, [order("0xaaa", state)])).toEqual({});
    }
  });

  it("releases an order that has dropped off the list entirely", () => {
    // The book is capped at fifty; an order that falls off it is not one to keep a
    // disabled button for forever.
    expect(keepEscrowed({ "0xaaa": "void" }, [order("0xbbb", "in_escrow")])).toEqual({});
  });

  it("holds one order without touching another", () => {
    const submitted = { "0xaaa": "capture" as const, "0xbbb": "void" as const };
    expect(
      keepEscrowed(submitted, [order("0xaaa", "in_escrow"), order("0xbbb", "settled")]),
    ).toEqual({ "0xaaa": "capture" });
  });

  // The list is re-read every five seconds. Returning a fresh object each time would
  // re-render every row to report that nothing happened.
  it("returns the very same object when nothing was dropped", () => {
    const submitted = { "0xaaa": "capture" as const };
    expect(keepEscrowed(submitted, [order("0xaaa", "in_escrow")])).toBe(submitted);
    expect(keepEscrowed({}, [])).not.toBeUndefined();
  });
});
