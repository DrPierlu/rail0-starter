import { getProduct, toCents } from "./catalog";
import type { CartLine } from "./order-view";

/**
 * Pricing a set of items against the catalog — used to QUOTE an order and, later, to
 * VERIFY the payment that claims to pay for it.
 *
 * One function for both on purpose. Without a stored order the merchant has no record
 * of what it quoted: the lines arrive in the payment's metadata, written by the payer,
 * so "what should this cost" has to be recomputed at authorize time. If quoting and
 * verifying used two code paths they could disagree, and the one that matters is the
 * one guarding the money.
 *
 * It prices against the CATALOG, never against the price the claim carries. The claim's
 * price is what the buyer says it was quoted; the catalog is what the merchant sells
 * for. A payment for less than the catalog total is refused whatever the claim says —
 * which is the whole point, since the metadata is attacker-controlled input in any
 * deployment where the buyer is not you.
 */

export class QuoteError extends Error {}

export interface QuotedOrder {
  lines: CartLine[];
  /** Human decimal total (e.g. "7.09"). */
  total: string;
  /** The same total in the token's base units. */
  total_base: string;
}

/** Cents (the catalog's own precision) to a token's base units. */
function centsToBase(cents: bigint, decimals: number): string {
  if (decimals < 2) throw new QuoteError(`unsupported token decimals: ${decimals}`);
  return (cents * 10n ** BigInt(decimals - 2)).toString();
}

/**
 * Price these items, or throw naming the first problem.
 *
 * Integer cents throughout: prices are two-decimal decimals, and 2.60 + 1.89 in binary
 * floating point is 4.489999999999999 — a total that would then disagree with the
 * payment by a rounding error, which reads as tampering.
 */
export function quote(
  items: readonly { product_id: string; qty: number }[],
  decimals: number,
): QuotedOrder {
  if (items.length === 0) throw new QuoteError("no items");

  let cents = 0n;
  const lines = items.map((item) => {
    const product = getProduct(item.product_id);
    if (!product) throw new QuoteError(`unknown product: ${item.product_id}`);
    if (!Number.isInteger(item.qty) || item.qty < 1) {
      throw new QuoteError(`invalid quantity for ${item.product_id}: ${item.qty}`);
    }
    cents += toCents(product.price) * BigInt(item.qty);
    return { product_id: product.id, name: product.name, price: product.price, qty: item.qty };
  });

  const totalBase = centsToBase(cents, decimals);
  const whole = totalBase.padStart(decimals + 1, "0");
  return {
    lines,
    total: `${whole.slice(0, whole.length - decimals)}.${whole.slice(whole.length - decimals)}`,
    total_base: totalBase,
  };
}

/**
 * Whether a payment's amount covers the catalog price of the lines it claims to pay for.
 *
 * Greater-or-equal, not equal: overpaying is the buyer's business and no reason for the
 * merchant to refuse escrowed funds. Underpaying is the attack — claim ten items, pay
 * for one — and it is the only comparison that stops it.
 *
 * A claim naming an unknown product, or no products at all, does not price and is
 * therefore not covered: an order the merchant cannot price is one it must not fulfil.
 */
export function coversCatalogPrice(
  claimedLines: readonly { product_id: string; qty: number }[],
  amountBase: string,
  decimals: number,
): boolean {
  let expected: string;
  try {
    expected = quote(claimedLines, decimals).total_base;
  } catch {
    return false;
  }
  try {
    return BigInt(amountBase) >= BigInt(expected);
  } catch {
    return false;
  }
}
