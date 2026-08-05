import catalogJson from "../../catalog.json";

export interface Product {
  id: string;
  name: string;
  description: string;
  /** Human decimal price in the payment stablecoin (e.g. "2.60"). */
  price: string;
  category: string;
}

export interface Catalog {
  merchant: { name: string };
  products: Product[];
}

const catalog = catalogJson as Catalog;

export function merchantName(): string {
  return catalog.merchant.name;
}

/**
 * Products, optionally narrowed by category and free-text search.
 *
 * `search` matches on ANY word of the query, against name, description AND category,
 * ranked by how many of the query's words a product matches.
 *
 * It used to be one literal substring match over name and description, which failed in
 * two ways worth naming, because both showed up as "no matching products" followed by the
 * agent retrying — the buyer saw the empty attempt.
 *
 *   A multi-word query never matched. "short sleeve tee" is not a substring of any
 *   description, so a perfectly sensible request found nothing while "tee" alone worked.
 *
 *   The catalog's own vocabulary was unreachable. Every product here is a `Tee` in
 *   category `T-Shirts`, so searching "t-shirt" — the word a buyer actually uses — matched
 *   nothing at all. Category is searched now, and "t-shirt" is a substring of "t-shirts".
 *
 * Word-level OR is deliberately forgiving: with a small catalog, too many results the
 * agent can narrow beats zero results it has to guess its way out of. Ranking is what
 * keeps that honest — a product matching two query words sorts above one matching one —
 * and the sort is stable, so equal scores keep the catalog's own order.
 */
export function listProducts(filter?: { category?: string; search?: string }): Product[] {
  let products = catalog.products;
  if (filter?.category) {
    const c = filter.category.toLowerCase();
    products = products.filter((p) => p.category.toLowerCase() === c);
  }

  const words = (filter?.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return products;

  return products
    .map((p) => {
      const haystack = `${p.name} ${p.description} ${p.category}`.toLowerCase();
      return { p, score: words.filter((w) => haystack.includes(w)).length };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((m) => m.p);
}

export function listCategories(): string[] {
  return [...new Set(catalog.products.map((p) => p.category))];
}

export function getProduct(id: string): Product | undefined {
  return catalog.products.find((p) => p.id === id);
}

/** Price arithmetic in integer cents so totals never touch floats. */
export function toCents(price: string): bigint {
  const [whole, frac = ""] = price.split(".");
  return BigInt(whole) * 100n + BigInt(`${frac}00`.slice(0, 2));
}

export function fromCents(cents: bigint): string {
  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, "0");
  return `${whole}.${frac}`;
}
