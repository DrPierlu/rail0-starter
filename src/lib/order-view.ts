/**
 * An order, projected from the payment the gateway already holds.
 *
 * There is no order store. An order IS a rail0 payment: the gateway records its
 * amount, token, chain, parties, status and every on-chain attempt, so keeping a
 * second copy here bought nothing but a way for the two to disagree — which is exactly
 * what it bought (the write-ahead, the reconciliation map, the stale flag, all of it
 * existed to manage that divergence).
 *
 * What the gateway cannot know is WHAT was bought, so the lines ride in the payment's
 * `metadata` (a jsonb column, 4096 bytes) under short keys. They are written by the
 * PAYER, so they are a claim, not a merchant record — see verifyLines: the storefront
 * checks them against its own catalog before authorizing, and after that the escrowed
 * amount is what binds.
 */

export type OrderState =
  | "awaiting_payment"
  | "authorizing"
  | "in_escrow"
  | "capturing"
  | "settled"
  | "voiding"
  | "cancelled"
  | "failed";

export interface CartLine {
  product_id: string;
  name: string;
  /** Human decimal unit price, as quoted when the order was placed. */
  price: string;
  qty: number;
}

export interface OrderToken {
  chain_id: number;
  chain_name?: string;
  symbol: string;
  address: string;
  decimals: number;
}

export interface Order {
  /** The rail0 payment id — one identity for the order and its payment. */
  id: string;
  state: OrderState;
  lines: CartLine[];
  /**
   * The total as a person reads it: always exactly two decimals, whatever the token's
   * own precision. Display only — `total_base` is the authoritative figure.
   */
  total: string;
  total_base: string;
  token: OrderToken;
  rail0_id: string;
  payment_status?: string;
  error?: string;
  created_at?: string;
  updated_at?: string;
  /**
   * The merchant's re-pricing of the lines this payment CLAIMS to pay for (#2).
   *
   * Present only on merchant-side reads, because only the merchant has the catalog. The
   * lines live in the payment's metadata and are written by the PAYER, so they are a
   * claim; `authorizePayment` prices that claim itself before escrowing anything. This
   * carries the comparison so the UI can show the control happening instead of leaving
   * the most important line of the demo invisible.
   *
   * It stands in for a LOOKUP, not for a mechanism of its own. A shop with an order store
   * checks a payment against the order it recorded at checkout; there is no store here, so
   * the catalog is the only record of what things cost that the payer cannot write.
   *
   * And it is a forecast, spent the moment the escrow exists — which is why the UI shows
   * it only before then (see `priceCheckNote` in order-ui).
   */
  price_check?: PriceCheck;
}

export interface PriceCheck {
  /** What the claimed lines cost at the merchant's current catalog, human decimals. */
  catalog_total: string;
  /** Whether the payment's amount covers it — the comparison that stops underpaying. */
  covered: boolean;
  /** Set when the claim does not price at all (unknown product, or no lines). */
  unpriceable?: boolean;
  /**
   * Why it does not price, when `unpriceable` — e.g. `unknown product: pouch`.
   *
   * Carried because the verdict alone cannot tell a claim that names something the shop
   * never sold from a product renamed in `catalog.json` after the order was placed. The
   * first is an attack, the second is housekeeping, and only the reason separates them.
   */
  reason?: string;
}

/** The compact metadata shape: short keys, because 4096 bytes is the whole budget. */
interface MetaLine {
  /** product id */ p: string;
  /** quantity */ q: number;
  /** unit price, human decimal, as quoted at purchase */ u: string;
  /** name, for a human reading the payment without the catalog */ n?: string;
}

/**
 * Cart lines packed for the payment's metadata.
 *
 * Self-describing on purpose — the unit price travels with the line. Re-deriving it
 * from the catalog at read time would make a later price change rewrite the history of
 * what was already paid, which is the one thing an order record must not do.
 */
export function packLines(lines: readonly CartLine[]): { lines: MetaLine[] } {
  return {
    lines: lines.map((line) => ({
      p: line.product_id,
      q: line.qty,
      u: line.price,
      n: line.name,
    })),
  };
}

/** The inverse. Tolerates metadata that is absent or not ours — it is a claim. */
export function unpackLines(metadata: unknown): CartLine[] {
  const raw = (metadata as { lines?: unknown } | null | undefined)?.lines;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    // The entry itself before its fields: `null` and `42` are both valid JSON in that
    // array, and reading `.p` off either throws — inside a parser whose whole job is to
    // survive input it did not write.
    if (typeof entry !== "object" || entry === null) return [];
    const line = entry as Partial<MetaLine>;
    if (typeof line.p !== "string" || typeof line.q !== "number") return [];
    return [
      {
        product_id: line.p,
        name: typeof line.n === "string" ? line.n : line.p,
        price: typeof line.u === "string" ? line.u : "0",
        qty: line.q,
      },
    ];
  });
}

/** A payment, reduced to what the projection reads. */
export interface PaymentLike {
  rail0_id?: string;
  id?: string;
  status?: string;
  amount?: string;
  token?: string;
  chain_id?: number;
  metadata?: unknown;
  created_at?: string;
  updated_at?: string;
  last_error_message?: string | null;
  last_error_code?: string | null;
  transactions?: {
    operation?: string;
    status?: string;
    error_message?: string | null;
    error_code?: string | null;
  }[];
}

const SETTLED = new Set(["captured", "partially_captured", "charged"]);
const RETURNED = new Set(["voided", "released", "refunded"]);
const IN_FLIGHT = new Set(["pending", "submitting", "submitted"]);
const IN_FLIGHT_STATE: Record<string, OrderState> = {
  authorize: "authorizing",
  charge: "authorizing",
  capture: "capturing",
  void: "voiding",
  release: "voiding",
};

/**
 * The order's state, from the payment's status and its on-chain attempts.
 *
 * Precedence, and it matters: an attempt still in flight outranks the status, because
 * the status only moves once that attempt confirms — reading the status alone would
 * show `in_escrow` for the whole time a capture is being mined, and the merchant would
 * press the button again. A FAILED last attempt outranks both, so a revert is visible
 * rather than looking like nothing happened.
 *
 * This replaces the old store's reconciliation map. The difference is not the mapping
 * but the direction: nothing is written back, so there is no state to drift.
 */
export function stateOf(payment: PaymentLike): OrderState {
  const transactions = payment.transactions ?? [];
  const last = transactions[transactions.length - 1];

  if (last && IN_FLIGHT.has(last.status ?? "")) {
    return IN_FLIGHT_STATE[last.operation ?? ""] ?? "awaiting_payment";
  }
  if (last?.status === "failed") return "failed";

  const status = payment.status ?? "";
  if (SETTLED.has(status)) return "settled";
  if (RETURNED.has(status)) return "cancelled";
  if (status === "authorized") return "in_escrow";
  return "awaiting_payment";
}

/**
 * Base units to a human decimal, exactly — see agent-budget for why not division.
 *
 * This is the figure to COMPUTE with (a capture asks the gateway for a human decimal
 * amount, and it must be the whole of it). `displayAmount` is the figure to SHOW.
 */
export function exactAmount(amount: string, decimals: number): string {
  const digits = amount.replace(/^0+(?=\d)/, "").padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  return decimals > 0 ? `${whole}.${digits.slice(digits.length - decimals)}` : whole;
}

/**
 * The same amount as a person reads it: two decimals, always.
 *
 * A token's decimals are a property of the CHAIN, not of the price — USDC's six turned
 * "1.25" into "1.250000" everywhere an order was shown, in the chat, the order card and
 * the merchant's list. Money in this app is quoted in cents (the catalog is), so two
 * places is the whole of the number and the rest is the contract's business.
 *
 * Anything finer than a cent — which cannot come from this catalog, but can come from a
 * payment made elsewhere — is rounded half-up rather than dropped, so a displayed total
 * is never LESS than what was actually paid. BigInt throughout: the values are base-unit
 * strings, and a stablecoin balance loses float precision long before it looks wrong.
 */
export function displayAmount(amount: string, decimals: number): string {
  let units: bigint;
  try {
    units = BigInt(amount || "0");
  } catch {
    return "0.00";
  }
  let cents: bigint;
  if (decimals >= 2) {
    const scale = 10n ** BigInt(decimals - 2);
    const remainder = units % scale;
    cents = units / scale + (remainder * 2n >= scale ? 1n : 0n);
  } else {
    cents = units * 10n ** BigInt(2 - decimals);
  }
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** The order this payment is. `token` supplies what the payment does not carry. */
export function orderFrom(payment: PaymentLike, token: OrderToken): Order {
  const base = payment.amount ?? "0";
  const last = (payment.transactions ?? []).at(-1);
  return {
    id: payment.rail0_id ?? payment.id ?? "",
    rail0_id: payment.rail0_id ?? "",
    state: stateOf(payment),
    lines: unpackLines(payment.metadata),
    total: displayAmount(base, token.decimals),
    total_base: base,
    token,
    payment_status: payment.status,
    error:
      last?.status === "failed"
        ? (last.error_message ?? last.error_code ?? "the on-chain operation failed")
        : (payment.last_error_message ?? undefined),
    created_at: payment.created_at,
    updated_at: payment.updated_at,
  };
}
