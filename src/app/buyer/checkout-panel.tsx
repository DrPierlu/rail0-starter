"use client";

import { useEffect, useState } from "react";
import {
  CHECKOUT_STEPS,
  type CheckoutStep,
  currentStep,
  type SigningStage,
  STEP_LABELS,
  stepIndex,
} from "@/lib/checkout-step";
import { TERMINAL_STATES } from "@/lib/order-ui";
import type { Order } from "@/lib/order-view";
import { pollWhileVisible } from "@/lib/poll";
import { CheckoutCard, type CheckoutOutput, type CheckoutStage } from "./checkout-card";
import { OrderCard } from "./order-card";
import { useWallet } from "./wallet";

/** Buyer-side poll: the shopper is watching an escrow confirm, so it stays brisk. */
const POLL_MS = 3000;

/**
 * The checkout, docked above the composer — the ONE place anything is actionable or
 * live.
 *
 * Before this there were several, and control moved between them: the pending
 * signature sat in its own box, the live order status sat in a card a few messages up
 * the transcript, the wallet prompt sat somewhere else again, and each was correct on
 * its own. Together they made the flow read as jumping around, because the person
 * doing the checkout had to work out which surface mattered now.
 *
 * So: one box, always in the same position, showing the current step and nothing else,
 * with a progress row saying how far along the sequence is. The transcript goes back to
 * being a transcript — narration and references, never a control.
 *
 * It owns the polling for the active order too (the reason OrderCard's `live` exists):
 * two cards polling the same order was both duplicated work and a second thing to look
 * at. Renders nothing at all when no checkout is in flight.
 */
export function CheckoutPanel({
  checkout,
  orderId,
  onContinue,
  onDone,
  busy,
}: {
  /** The checkout still in flight, if any. */
  checkout?: CheckoutOutput;
  /** The order the transcript is about, once one exists. */
  orderId?: string;
  onContinue: (text: string) => void;
  onDone?: (key: string) => void;
  busy: boolean;
}) {
  const { wallet } = useWallet();
  const [order, setOrder] = useState<Order | undefined>(undefined);
  // How far the card has got. It is the card that knows — it is the one talking to the
  // wallet and to the checkout routes — so the progress row follows it rather than
  // guessing from the order, which does not even exist for the first two steps.
  const [stage, setStage] = useState<CheckoutStage>("sign_login");
  // The payment the card created, known here the moment it exists so the panel can go
  // live on it without waiting for the agent's next tool call.
  const [cardOrderId, setCardOrderId] = useState<string | undefined>(undefined);

  const activeOrderId = cardOrderId ?? orderId;

  // The active order's state, polled here so it is read in exactly one place. Stops at
  // a terminal state, and starts over if the panel moves to a different order.
  const state = order?.state;
  useEffect(() => {
    if (!activeOrderId) {
      setOrder(undefined);
      return;
    }
    if (state && TERMINAL_STATES.has(state)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/shop/orders/${activeOrderId}`);
        if (cancelled || !res.ok) return;
        const body = (await res.json()) as { order?: Order };
        if (body.order) setOrder(body.order);
      } catch {
        // transient — the next tick retries
      }
    };
    const stop = pollWhileVisible(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [activeOrderId, state]);

  // The order in state may be a previous one for a tick after the id changes; only
  // trust its state when it is the order the panel is actually about.
  const step =
    currentStep({
      hasWallet: !!wallet,
      awaitingSignature: checkout ? AWAITING[stage] : undefined,
      orderState: order?.id === activeOrderId ? order?.state : undefined,
    }) ??
    // A checkout in flight always has something to show, even in the gap between the
    // payment being submitted and the first poll answering for it.
    (checkout ? "confirming" : null);

  if (!step) return null;

  return (
    <div className="border-t border-neutral-200 pt-2 dark:border-neutral-800">
      <StepRow step={step} />
      <div className="mt-2">
        {checkout ? (
          <CheckoutCard
            // Keyed on the checkout: a new one must start at its first step rather than
            // inherit the finished card's stage and payment.
            key={checkout.checkout_id}
            output={checkout}
            onContinue={onContinue}
            onStage={setStage}
            onOrder={setCardOrderId}
            onDone={onDone}
            busy={busy}
          />
        ) : activeOrderId ? (
          // Live: this is the single polling card now, and it reads the order this
          // panel already fetched rather than opening a second loop.
          <OrderCard orderId={activeOrderId} initial={order} live={false} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * The signature the card is waiting for at each stage — including the two stages where
 * it is waiting on the network instead. `creating` sits between the two signatures, and
 * naming the NEXT one there is what keeps the progress row moving forward rather than
 * flicking back to step 1 while the payment is created.
 */
const AWAITING: Record<CheckoutStage, SigningStage | undefined> = {
  sign_login: "sign_login",
  creating: "sign_payment",
  sign_payment: "sign_payment",
  submitting: undefined,
  done: undefined,
};

/** The sequence, with everything before the current step marked done. */
function StepRow({ step }: { step: CheckoutStep }) {
  const at = stepIndex(step);
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
      {CHECKOUT_STEPS.map((s, i) => {
        const done = i < at;
        const current = i === at;
        return (
          <li key={s} className="flex items-center gap-1.5">
            <span
              className={
                done
                  ? "size-1.5 rounded-full bg-emerald-500"
                  : current
                    ? "size-1.5 animate-pulse rounded-full bg-blue-500"
                    : "size-1.5 rounded-full bg-neutral-300 dark:bg-neutral-700"
              }
            />
            <span
              className={
                current
                  ? "font-medium text-neutral-900 dark:text-neutral-100"
                  : done
                    ? "text-neutral-500"
                    : "text-neutral-400"
              }
            >
              {STEP_LABELS[s]}
            </span>
          </li>
        );
      })}
      {step === "done" && (
        <li className="font-medium text-emerald-600 dark:text-emerald-400">{STEP_LABELS.done}</li>
      )}
    </ol>
  );
}
