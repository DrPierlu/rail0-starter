import { describe, expect, it } from "vitest";
import { listProducts } from "@/lib/catalog";

// The bug this pins showed up as "no matching products" followed by the agent retrying
// with a different query — the shopper saw the empty attempt. Search was ONE literal
// substring match over name and description.
describe("listProducts search", () => {
  it("finds the catalog's own vocabulary through the category", () => {
    // Every product is a "Tee" in category "T-Shirts", so the word a buyer actually uses
    // matched nothing before category was searched.
    const hits = listProducts({ search: "t-shirt" });
    expect(hits.length).toBeGreaterThan(0);
  });

  it("matches a multi-word query on any of its words, best first", () => {
    // "short sleeve tee" is not a substring of any description — as one literal string it
    // found nothing. Per word it finds the tees AND, deliberately, the Shorts (they match
    // "short"): word-level OR widens, and ranking is what keeps that usable, so the
    // product matching most of the query comes first.
    const hits = listProducts({ search: "short sleeve tee" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.category).toBe("T-Shirts");
    // Every hit matches at least one word — nothing unrelated slipped in.
    const words = ["short", "sleeve", "tee"];
    expect(
      hits.every((p) =>
        words.some((w) => `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(w)),
      ),
    ).toBe(true);
  });

  it("ranks a product matching more of the query first", () => {
    const hits = listProducts({ search: "slim tee" });
    // "Slim-Fit Tee" matches both words; every other tee matches only "tee".
    expect(hits[0]?.name).toMatch(/slim/i);
  });

  it("still returns nothing for a query the catalog has no word for", () => {
    expect(listProducts({ search: "snowboard" })).toEqual([]);
  });

  it("returns everything when no search is given", () => {
    expect(listProducts().length).toBe(listProducts({ search: "   " }).length);
  });

  it("keeps the category filter exact", () => {
    const hits = listProducts({ category: "T-Shirts" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((p) => p.category === "T-Shirts")).toBe(true);
    expect(listProducts({ category: "t-shirt" })).toEqual([]);
  });
});
