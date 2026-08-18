import { describe, expect, it } from "vitest";
import { priceCheckNote } from "@/lib/order-ui";
import type { PriceCheck } from "@/lib/order-view";

/**
 * Where the merchant's price check is allowed to speak.
 *
 * The regression this pins: the check was rendered on every row of the order book, and
 * because the catalog is live while the claim in a payment's metadata is frozen, renaming
 * a product made settled orders — captured funds, weeks old — announce "will not be
 * escrowed". The verdict is a forecast, and a forecast about an escrow that already
 * happened is not a stale label, it is a false one.
 */

const covered: PriceCheck = { catalog_total: "7.09", covered: true };
const underpaid: PriceCheck = { catalog_total: "7.09", covered: false };
const unpriceable: PriceCheck = {
  catalog_total: "—",
  covered: false,
  unpriceable: true,
  reason: "unknown product: pouch",
};

describe("priceCheckNote", () => {
  it("warns before the escrow exists, where the verdict still decides something", () => {
    expect(priceCheckNote("awaiting_payment", underpaid)).toEqual({
      tone: "bad",
      text: "underpaid — will not be escrowed",
    });
  });

  it("names why a claim does not price, so a catalog edit is not read as an attack", () => {
    const note = priceCheckNote("awaiting_payment", unpriceable);
    expect(note?.tone).toBe("bad");
    expect(note?.text).toContain("unknown product: pouch");
  });

  it("says nothing once the funds are in escrow, whatever the catalog now says", () => {
    for (const state of [
      "in_escrow",
      "capturing",
      "settled",
      "voiding",
      "cancelled",
      "failed",
    ] as const) {
      expect(priceCheckNote(state, unpriceable)).toBeUndefined();
      expect(priceCheckNote(state, underpaid)).toBeUndefined();
      expect(priceCheckNote(state, covered)).toBeUndefined();
    }
  });

  it("keeps the positive note while the authorize is in flight, and never a negative one", () => {
    expect(priceCheckNote("authorizing", covered)?.tone).toBe("ok");
    // Nothing that failed the check can be authorizing at all, so a red badge here could
    // only be the catalog having moved since — never a reason to alarm the merchant.
    expect(priceCheckNote("authorizing", unpriceable)).toBeUndefined();
    expect(priceCheckNote("authorizing", underpaid)).toBeUndefined();
  });

  it("shows nothing at all when there is no check to show", () => {
    expect(priceCheckNote("awaiting_payment", undefined)).toBeUndefined();
  });
});
