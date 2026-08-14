import { describe, expect, it } from "vitest";
import { fromBaseUnits, sumBaseUnits, windowStart, withinBudget } from "@/lib/agent-budget";

const policy = { perOrder: 25, perWindow: 100 };

describe("withinBudget", () => {
  it("allows an order under both ceilings", () => {
    expect(withinBudget({ orderTotal: "9.90", spent: "10.00", ...policy })).toBe(true);
  });

  it("refuses an order over the per-order ceiling, however little was spent", () => {
    expect(withinBudget({ orderTotal: "25.01", spent: "0.00", ...policy })).toBe(false);
  });

  it("refuses an order that fits alone but not on top of what was spent", () => {
    // The case a per-order ceiling cannot catch on its own: four orders of 25 are each
    // allowed and together are 100. This is the whole reason the window ceiling exists.
    expect(withinBudget({ orderTotal: "25.00", spent: "80.00", ...policy })).toBe(false);
    expect(withinBudget({ orderTotal: "20.00", spent: "80.00", ...policy })).toBe(true);
  });

  it("treats 0 as no ceiling, on either", () => {
    expect(withinBudget({ orderTotal: "1000", spent: "0", perOrder: 0, perWindow: 0 })).toBe(true);
    expect(withinBudget({ orderTotal: "1000", spent: "9999", perOrder: 0, perWindow: 0 })).toBe(
      true,
    );
    // Only the window is off: the per-order ceiling still bites.
    expect(withinBudget({ orderTotal: "26", spent: "0", perOrder: 25, perWindow: 0 })).toBe(false);
  });

  it("escalates anything it cannot read rather than passing it", () => {
    // Number("") is 0 — an empty total would otherwise read as a free order and buy
    // itself. NaN compares false in both directions, which silently picks an answer.
    for (const bad of ["", "  ", "abc", "NaN"]) {
      expect(withinBudget({ orderTotal: bad, spent: "0", ...policy })).toBe(false);
      expect(withinBudget({ orderTotal: "1.00", spent: bad, ...policy })).toBe(false);
    }
  });

  it("refuses a negative spend, which can only be a bad read", () => {
    expect(withinBudget({ orderTotal: "1.00", spent: "-500", ...policy })).toBe(false);
  });
});

describe("fromBaseUnits", () => {
  it("converts with the token's decimals", () => {
    expect(fromBaseUnits("100000", 6)).toBe("0.100000");
    expect(fromBaseUnits("2600000", 6)).toBe("2.600000");
    expect(fromBaseUnits("0", 6)).toBe("0.000000");
  });

  it("keeps a value too large for a float exact", () => {
    // 18-decimal tokens exceed Number.MAX_SAFE_INTEGER long before the amount looks
    // unusual — dividing here is where the digits would quietly go.
    expect(fromBaseUnits("123456789012345678901", 18)).toBe("123.456789012345678901");
  });

  it("handles zero decimals", () => {
    expect(fromBaseUnits("42", 0)).toBe("42");
  });
});

describe("sumBaseUnits", () => {
  it("sums exactly, in BigInt", () => {
    expect(sumBaseUnits(["100000", "2600000", "1890000"])).toBe("4590000");
    expect(sumBaseUnits([])).toBe("0");
  });

  it("is exact past the float safe range", () => {
    const big = "9007199254740993"; // MAX_SAFE_INTEGER + 2
    expect(sumBaseUnits([big, "1"])).toBe("9007199254740994");
  });
});

describe("windowStart", () => {
  it("is the ISO timestamp `hours` before now", () => {
    const now = new Date("2026-08-14T12:00:00.000Z");
    expect(windowStart(now, 24)).toBe("2026-08-13T12:00:00.000Z");
    expect(windowStart(now, 1)).toBe("2026-08-14T11:00:00.000Z");
  });
});
