import { describe, expect, it } from "vitest";
import { type CartLine, cartTotal, mergeLine, removeLine } from "../agent/lib/cart";

// The cart moved from the merchant's store to the AGENT's session state (#5), and
// eve's defineState only resolves inside its runtime — so the rules live in pure
// reducers and these test those. Same behaviour the old store test covered, plus the
// edges it did not.
const line = (id: string, qty: number): CartLine => ({
  product_id: id,
  name: id.toUpperCase(),
  price: "1.00",
  qty,
});

describe("mergeLine", () => {
  it("appends a new product and merges quantities for one already there", () => {
    let lines = mergeLine([], line("a", 1));
    lines = mergeLine(lines, line("a", 2));
    lines = mergeLine(lines, line("b", 1));

    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.product_id === "a")?.qty).toBe(3);
  });

  it("does not mutate the input", () => {
    const original = [line("a", 1)];
    mergeLine(original, line("a", 5));

    expect(original[0]?.qty).toBe(1);
  });
});

describe("removeLine", () => {
  it("subtracts a quantity, and drops the line when none is given", () => {
    const lines = [line("a", 3), line("b", 1)];

    expect(removeLine(lines, "a", 1).find((l) => l.product_id === "a")?.qty).toBe(2);
    expect(removeLine(lines, "a").find((l) => l.product_id === "a")).toBeUndefined();
  });

  // Asking for more than is there means "take it out" — an error here would only
  // become something the model has to explain to the user.
  it("drops the line when more units are removed than are present", () => {
    expect(removeLine([line("a", 2)], "a", 5)).toEqual([]);
  });

  it("leaves the cart alone for an unknown product", () => {
    const lines = [line("a", 1)];
    expect(removeLine(lines, "zzz", 1)).toEqual(lines);
  });
});

describe("cartTotal", () => {
  const priced = (price: string, qty: number): CartLine => ({
    product_id: `p-${price}`,
    name: "P",
    price,
    qty,
  });

  it("sums price by quantity", () => {
    expect(cartTotal([priced("2.60", 2), priced("1.89", 1)])).toBe("7.09");
  });

  it("is exact where floating point is not", () => {
    // 2.60 + 1.89 in binary floating point is 4.489999999999999, which would then
    // disagree with the order the storefront creates. Summed in integer cents it does
    // not — and this total gates spending, so "close enough" is not a property it may
    // have.
    expect(cartTotal([priced("2.60", 1), priced("1.89", 1)])).toBe("4.49");
    expect(cartTotal([priced("0.10", 3)])).toBe("0.30");
  });

  it("is 0.00 for an empty cart", () => {
    expect(cartTotal([])).toBe("0.00");
  });

  it("reports a price it cannot read as unusable, not as zero", () => {
    // The caller compares this against the spending ceiling. A broken catalog price
    // must not read as a free order — "NaN" fails withinAutonomousLimit, which sends
    // the checkout to a human.
    expect(cartTotal([priced("2.60", 1), priced("free", 1)])).toBe("NaN");
  });
});
