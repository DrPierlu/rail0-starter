import type { OrderState } from "./store";

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
