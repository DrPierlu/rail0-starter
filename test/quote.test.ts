import { describe, expect, it } from "vitest";
import { listProducts } from "@/lib/catalog";
import { coversCatalogPrice, QuoteError, quote } from "@/lib/quote";

// Real catalog ids, so the test prices what the app prices.
const [first, second] = listProducts().slice(0, 2);

describe("quote", () => {
  it("prices from the catalog, in the token's base units", () => {
    const quoted = quote([{ product_id: first.id, qty: 1 }], 6);
    expect(quoted.lines).toHaveLength(1);
    expect(quoted.lines[0].price).toBe(first.price);
    expect(quoted.total).toBe(`${first.price}0000`.slice(0, first.price.length + 4));
    expect(BigInt(quoted.total_base)).toBe(BigInt(Math.round(Number(first.price) * 100)) * 10_000n);
  });

  it("multiplies by quantity and sums exactly", () => {
    // Integer cents throughout: these two in binary floating point come to
    // 4.489999999999999, and a total that disagrees with the payment by a rounding
    // error reads as tampering.
    const quoted = quote(
      [
        { product_id: first.id, qty: 2 },
        { product_id: second.id, qty: 1 },
      ],
      6,
    );
    const expected =
      (BigInt(Math.round(Number(first.price) * 100)) * 2n +
        BigInt(Math.round(Number(second.price) * 100))) *
      10_000n;
    expect(quoted.total_base).toBe(expected.toString());
  });

  it("refuses an unknown product, an empty order and a bad quantity", () => {
    expect(() => quote([], 6)).toThrow(QuoteError);
    expect(() => quote([{ product_id: "not-a-product", qty: 1 }], 6)).toThrow(/unknown product/);
    expect(() => quote([{ product_id: first.id, qty: 0 }], 6)).toThrow(/invalid quantity/);
    expect(() => quote([{ product_id: first.id, qty: 1.5 }], 6)).toThrow(/invalid quantity/);
    expect(() => quote([{ product_id: first.id, qty: -2 }], 6)).toThrow(/invalid quantity/);
  });
});

describe("coversCatalogPrice", () => {
  const items = [{ product_id: first.id, qty: 2 }];
  const exact = quote(items, 6).total_base;

  it("accepts the exact price and an overpayment", () => {
    expect(coversCatalogPrice(items, exact, 6)).toBe(true);
    expect(coversCatalogPrice(items, (BigInt(exact) + 1n).toString(), 6)).toBe(true);
  });

  it("refuses an underpayment, by any margin", () => {
    // The attack it exists for: claim ten items in the metadata, escrow the price of
    // one. The metadata is written by the payer, so this comparison is the only thing
    // between that claim and a fulfilled order.
    expect(coversCatalogPrice(items, (BigInt(exact) - 1n).toString(), 6)).toBe(false);
    expect(coversCatalogPrice(items, "0", 6)).toBe(false);
  });

  it("refuses a claim it cannot price at all", () => {
    // An order the merchant cannot price is one it must not fulfil — including the
    // empty claim, which would otherwise cost nothing and cover any amount.
    expect(coversCatalogPrice([], "1000000000", 6)).toBe(false);
    expect(coversCatalogPrice([{ product_id: "ghost", qty: 1 }], "1000000000", 6)).toBe(false);
  });

  it("refuses an amount that is not a number, rather than throwing", () => {
    // It reads a field off a payment; a malformed one must be a refusal, not a 500.
    expect(coversCatalogPrice(items, "", 6)).toBe(false);
    expect(coversCatalogPrice(items, "1.5", 6)).toBe(false);
    expect(coversCatalogPrice(items, "abc", 6)).toBe(false);
  });
});
