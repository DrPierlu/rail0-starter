import { TERMINAL_STATES } from "./order-ui";
import type { OrderState } from "./store";

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
 * Precedence is the point. A pending signature outranks the order's state, because an
 * order sits at `awaiting_payment` for the whole time the payer is signing: reading
 * the state first would report "confirming" while the buyer still has something to do.
 * And an unconnected wallet outranks the signature itself — there is no way to sign
 * without one, so asking for the wallet IS the current step rather than an error to
 * discover after pressing a button.
 */
export function currentStep(input: {
  hasWallet: boolean;
  /** The signing step still waiting for this buyer, if any. */
  pendingSigning?: "sign_login" | "sign_payment";
  /** The active order's state, once there is an order. */
  orderState?: OrderState;
}): CheckoutStep | null {
  if (input.pendingSigning) {
    return input.hasWallet ? input.pendingSigning : "connect";
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

/** A transcript part, reduced to what deciding the pending signature needs. */
export type CheckoutEvent =
  | { kind: "signing"; key: string; orderId?: string }
  | { kind: "order"; orderId: string };

/**
 * The signature still owed, from the transcript in order — or null if none is.
 *
 * The transcript is the authority, not the set of keys signed in this tab. That set is
 * component state while the transcript is restored from sessionStorage, so on its own it
 * reported every already-signed step as unsigned after a reload: the docked box offered
 * to sign a payment the transcript itself showed as submitted and confirming.
 *
 * So an `order` event for the same order appearing AFTER a `signing` event clears it —
 * submitting an order, or reading its state, is only reachable once it is signed.
 * `signedKeys` still carries the moment between signing and the agent's next tool call,
 * when the transcript holds no such proof yet.
 */
export function pendingSignature(
  events: readonly CheckoutEvent[],
  signedKeys: ReadonlySet<string>,
): { key: string; orderId?: string } | null {
  let pending: { key: string; orderId?: string } | null = null;
  for (const event of events) {
    if (event.kind === "signing") {
      pending = signedKeys.has(event.key) ? null : { key: event.key, orderId: event.orderId };
      continue;
    }
    if (pending?.orderId === event.orderId) pending = null;
  }
  return pending;
}
