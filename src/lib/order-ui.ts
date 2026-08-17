import type { OrderState } from "./order-view";

// Shared order-state presentation, used by both the buyer chat's live order
// card and the merchant back-office so the same state always looks the same.

export const STATE_STYLES: Record<OrderState, string> = {
  awaiting_payment: "bg-neutral-500/10 text-neutral-500",
  authorizing: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  in_escrow: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  capturing: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  settled: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  voiding: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  cancelled: "bg-neutral-500/10 text-neutral-500",
  failed: "bg-red-500/10 text-red-600 dark:text-red-400",
};

/** States with an on-chain broadcast in flight — worth animating. */
export const IN_FLIGHT_STATES: ReadonlySet<OrderState> = new Set([
  "authorizing",
  "capturing",
  "voiding",
]);

/** States the order can never leave — polling can stop here. */
export const TERMINAL_STATES: ReadonlySet<OrderState> = new Set(["settled", "cancelled", "failed"]);

export function stateLabel(state: OrderState): string {
  return state.replace(/_/g, " ");
}

export function shortId(rail0Id: string): string {
  return `${rail0Id.slice(0, 10)}…${rail0Id.slice(-6)}`;
}

// ── Where the money is (#1: make escrow visible) ─────────────────────────────
//
// The one thing that distinguishes this from a card checkout, and the one thing a
// status pill cannot say: funds do not move when the buyer SIGNS. They move on
// `authorize`, into the contract's escrow, and reach the merchant only on `capture`.
// A demo that only shows a changing word makes rail0 look like a slower Stripe; a
// demo that shows the money sitting in escrow explains the whole product.

export type Custodian = "buyer" | "escrow" | "merchant";

export interface EscrowStep {
  custodian: Custodian;
  label: string;
  /** Reached: the funds have been here (or are here now). */
  done: boolean;
  /** The funds are here right now. */
  current: boolean;
  /** A broadcast is in flight moving them out of here. */
  moving: boolean;
}

/**
 * The three custodians an order's money passes through, marked for the state it is in.
 *
 * A returned order (voided/released) is NOT "settled to merchant" — the third step
 * relabels, because the money went back rather than forward. Getting that wrong would
 * teach the opposite of what escrow means.
 */
export function escrowSteps(state: OrderState): EscrowStep[] {
  const returning = state === "voiding" || state === "cancelled";
  const at: Record<OrderState, Custodian> = {
    awaiting_payment: "buyer",
    authorizing: "buyer",
    in_escrow: "escrow",
    capturing: "escrow",
    settled: "merchant",
    voiding: "escrow",
    cancelled: "buyer",
    failed: "buyer",
  };
  const order: Custodian[] = ["buyer", "escrow", "merchant"];
  const reachedIndex = order.indexOf(at[state]);
  const movingFrom: Record<string, Custodian> = {
    authorizing: "buyer",
    capturing: "escrow",
    voiding: "escrow",
  };
  return order.map((custodian, index) => ({
    custodian,
    label:
      custodian === "buyer"
        ? state === "cancelled"
          ? "returned to buyer"
          : "buyer's wallet"
        : custodian === "escrow"
          ? "in escrow"
          : returning
            ? "not settled"
            : "settled to merchant",
    done: index <= reachedIndex,
    current: index === reachedIndex,
    moving: movingFrom[state] === custodian,
  }));
}

/**
 * Why an order sits in an in-flight state for minutes, in the buyer's words.
 *
 * The gateway is notified only once the chain calls the block settled — its `safe` or
 * `finalized` tag, not one confirmation (rail0-gateway#195,
 * rail0-indexer#91). That is seconds on some chains and ~11 minutes on Arbitrum
 * Sepolia, so a spinner with no explanation is indistinguishable from a hang. The
 * per-chain figure is not published yet (rail0-gateway#200), so the copy stays
 * qualitative rather than inventing a number per chain.
 */
export function waitExplainer(state: OrderState): string | undefined {
  if (!IN_FLIGHT_STATES.has(state)) return undefined;
  return "Waiting for the chain to call the block settled — not one confirmation, so this can take a few minutes on some chains. The funds are already committed on-chain.";
}
