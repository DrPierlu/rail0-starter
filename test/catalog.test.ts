import { describe, expect, it } from "vitest";
import { fromCents, getProduct, listCategories, listProducts, toCents } from "@/lib/catalog";

describe("price arithmetic", () => {
  it("converts decimal prices to cents and back", () => {
    expect(toCents("2.60")).toBe(260n);
    expect(toCents("0.05")).toBe(5n);
    expect(toCents("10")).toBe(1000n);
    expect(fromCents(715n)).toBe("7.15");
    expect(fromCents(1000n)).toBe("10.00");
    expect(fromCents(5n)).toBe("0.05");
  });

  it("round-trips every catalog price", () => {
    for (const product of listProducts()) {
      expect(fromCents(toCents(product.price))).toBe(Number(product.price).toFixed(2));
    }
  });
});

describe("catalog", () => {
  it("finds products by id", () => {
    const first = listProducts()[0];
    expect(getProduct(first.id)?.name).toBe(first.name);
    expect(getProduct("nope")).toBeUndefined();
  });

  it("filters by category (case-insensitive)", () => {
    const category = listCategories()[0];
    const filtered = listProducts({ category: category.toUpperCase() });
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((p) => p.category === category)).toBe(true);
  });

  it("filters by free-text search", () => {
    const target = listProducts()[0];
    const filtered = listProducts({ search: target.name.toLowerCase() });
    expect(filtered.some((p) => p.id === target.id)).toBe(true);
  });
});
