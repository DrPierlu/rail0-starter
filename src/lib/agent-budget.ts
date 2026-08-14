import { env } from "./env";
import { addressFor, clientFor } from "./rail0";

/**
 * How much the agent has already spent, and whether it may spend more.
 *
 * THE GATEWAY IS THE LEDGER. Nothing here writes a record, because a record the agent
 * keeps is not a record: it would be the same process, authoring its own audit. Every
 * purchase is already a rail0 payment with an amount, a payer and a timestamp, held by
 * the gateway and settled on-chain — authoritative, and beyond this code's reach to
 * rewrite. So the budget is a QUESTION asked of the gateway, not a counter maintained
 * beside it, and there is no store, table or migration behind this file.
 *
 * The per-session budget is a different thing and does not belong here: eve's own
 * durable state covers it. What this adds is the part eve cannot — a ceiling that
 * survives "New conversation", which starts a fresh session and would otherwise reset
 * a session-scoped cap with one click.
 */

/** Everything the agent committed counts, whatever became of it — see spentInWindow. */
export interface BudgetInput {
  /** This order's total, human decimal. */
  orderTotal: string;
  /** Already committed inside the window, human decimal. */
  spent: string;
  /** Per-order ceiling; 0 means none. */
  perOrder: number;
  /** Per-window ceiling; 0 means none. */
  perWindow: number;
}

/**
 * Whether this order fits under both ceilings.
 *
 * Pure, so the decision is testable without a gateway — the fetch above it is the part
 * that can fail, and it fails to "ask a human" rather than to a verdict.
 *
 * An unreadable number is never within budget. Number("") is 0 and would otherwise read
 * as a free order; a NaN comparison is false in both directions, which silently picks
 * one. Both become "ask".
 */
export function withinBudget(input: BudgetInput): boolean {
  // Blank is checked before Number(), on BOTH, and the second one is the dangerous
  // direction: Number("") is 0, so an unreadable SPEND would read as "has spent
  // nothing" and widen the remaining budget to the full ceiling — the failure that
  // grants permission instead of withholding it.
  const readable = (value: string) => value.trim() !== "" && Number.isFinite(Number(value));
  if (!readable(input.orderTotal) || !readable(input.spent)) return false;

  const total = Number(input.orderTotal);
  const spent = Number(input.spent);
  if (spent < 0) return false;

  if (input.perOrder > 0 && total > input.perOrder) return false;
  if (input.perWindow > 0 && total + spent > input.perWindow) return false;
  return true;
}

/** Start of the rolling window, as the ISO timestamp the gateway filters on. */
export function windowStart(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

/**
 * Base units to a human decimal string, exactly.
 *
 * String arithmetic rather than division: amounts arrive as base-unit strings and a
 * USDC balance large enough to matter loses precision as a float long before it looks
 * wrong. The budget is compared as a number afterwards, but the conversion itself must
 * not be where the digits go.
 */
export function fromBaseUnits(amount: string, decimals: number): string {
  const digits = amount.replace(/^0+(?=\d)/, "").padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? `.${digits.slice(digits.length - decimals)}` : "";
  return `${whole}${fraction}`;
}

/** Sum of base-unit strings, as a base-unit string — BigInt, so nothing rounds. */
export function sumBaseUnits(amounts: readonly string[]): string {
  return amounts.reduce((total, amount) => total + BigInt(amount || "0"), 0n).toString();
}

/**
 * What the agent has committed on one token in the rolling window, human decimal.
 *
 * Scoped to ONE token and chain because a budget in mixed currencies is not a number:
 * the ceiling is denominated in the stablecoin being paid with, so the question asked
 * is the one the ceiling can answer.
 *
 * EVERY payment it created counts, whatever became of it — including one later voided
 * or released. A spending limit is about what the agent committed while running
 * unattended, not about what it ended up keeping, and the conservative reading is the
 * one that fails safe. It also avoids a race the other reading has: a payment in flight
 * has no final status yet, and not counting it would let a burst slip under the
 * ceiling.
 */
export async function spentInWindow(params: {
  tokenAddress: string;
  chainId: number;
  decimals: number;
  hours: number;
  now?: Date;
}): Promise<string> {
  const client = await clientFor("agent");
  const page = await client.payments.list({
    payer: addressFor("agent"),
    token: params.tokenAddress,
    chain_id: params.chainId,
    created_from: windowStart(params.now ?? new Date(), params.hours),
    per_page: 100,
  });
  const amounts = (page.data ?? []).map((payment) => payment.amount ?? "0");
  return fromBaseUnits(sumBaseUnits(amounts), params.decimals);
}

/** The two ceilings and the window, from the environment — see .env.example. */
export function budgetPolicy(): { perOrder: number; perWindow: number; hours: number } {
  return {
    perOrder: env().BUYER_MAX_ORDER,
    perWindow: env().BUYER_MAX_WINDOW,
    hours: env().BUYER_WINDOW_HOURS,
  };
}
