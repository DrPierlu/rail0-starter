import { TERMINAL_STATES } from "./order-ui";
import type { OrderState } from "./order-view";

/**
 * Where a checkout has got to — the single source for what the docked panel shows.
 *
 * The buyer flow used to have no notion of "which step am I on": each surface knew
 * only its own piece, so the transcript grew a signing card here, a live order card
 * there, and a wallet prompt somewhere else, and the person doing the checkout had to
 * assemble the sequence themselves. Naming the steps in one place is what lets the
 * panel show one action at a time and say how far along it is.
 */
export const CHECKOUT_STEPS = ["connect", "sign_login", "sign_payment", "confirming"] as const;

export type CheckoutStep = (typeof CHECKOUT_STEPS)[number] | "done";

/** The two signatures the checkout card asks for, in order. */
export type SigningStage = "sign_login" | "sign_payment";

export const STEP_LABELS: Record<CheckoutStep, string> = {
  connect: "Connect wallet",
  sign_login: "Sign in",
  sign_payment: "Sign payment",
  confirming: "Confirming",
  done: "Done",
};

/**
 * The step to act on now, or null when there is no checkout in flight (nothing to
 * dock — the panel hides).
 *
 * Precedence is the point. A signature the card is waiting for outranks the order's
 * state, because for most of the checkout there IS no order yet — the payment is created
 * between the two signatures — and reading the state first would report nothing at all
 * while the buyer still has something to do. And an unconnected wallet outranks the
 * signature itself: there is no way to sign without one, so asking for the wallet IS the
 * current step rather than an error to discover after pressing a button.
 */
export function currentStep(input: {
  hasWallet: boolean;
  /** The signature the card is waiting on, if any. */
  awaitingSignature?: SigningStage;
  /** The order's state, once the payment exists. */
  orderState?: OrderState;
}): CheckoutStep | null {
  if (input.awaitingSignature) {
    return input.hasWallet ? input.awaitingSignature : "connect";
  }
  if (!input.orderState) return null;
  return TERMINAL_STATES.has(input.orderState) ? "done" : "confirming";
}

/**
 * Index of `step` in the progress row, for rendering what is done / current / ahead.
 * `done` sits one past the last step, so every step reads as complete.
 */
export function stepIndex(step: CheckoutStep): number {
  return step === "done" ? CHECKOUT_STEPS.length : CHECKOUT_STEPS.indexOf(step);
}

/** A transcript part, reduced to what deciding the pending checkout needs. */
export type CheckoutEvent = { kind: "checkout"; key: string } | { kind: "order"; orderId: string };

/**
 * The checkout still owed its signatures, from the transcript in order — or null.
 *
 * The transcript is the authority, not the set of checkouts completed in this tab. That
 * set is component state while the transcript is restored from sessionStorage, so on its
 * own it reported an already-finished checkout as pending after a reload: the docked box
 * offered to sign a payment the transcript itself showed as confirming.
 *
 * So an `order` event appearing AFTER a `checkout` event clears it. An order can only
 * exist once that checkout produced it — the payment is created by the card, mid-flow —
 * so seeing one is proof the flow moved on. `completed` still carries the moment between
 * the card finishing and the agent's next tool call, when the transcript holds no such
 * proof yet.
 */
export function pendingCheckout(
  events: readonly CheckoutEvent[],
  completed: ReadonlySet<string>,
): { key: string } | null {
  let pending: { key: string } | null = null;
  for (const event of events) {
    if (event.kind === "checkout") {
      pending = completed.has(event.key) ? null : { key: event.key };
      continue;
    }
    pending = null;
  }
  return pending;
}
