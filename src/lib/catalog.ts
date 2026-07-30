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

export function listProducts(filter?: { category?: string; search?: string }): Product[] {
  let products = catalog.products;
  if (filter?.category) {
    const c = filter.category.toLowerCase();
    products = products.filter((p) => p.category.toLowerCase() === c);
  }
  if (filter?.search) {
    const s = filter.search.toLowerCase();
    products = products.filter(
      (p) => p.name.toLowerCase().includes(s) || p.description.toLowerCase().includes(s),
    );
  }
  return products;
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
