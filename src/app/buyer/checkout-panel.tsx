"use client";

import { useEffect, useState } from "react";
import {
  CHECKOUT_STEPS,
  type CheckoutStep,
  currentStep,
  STEP_LABELS,
  stepIndex,
} from "@/lib/checkout-step";
import { TERMINAL_STATES } from "@/lib/order-ui";
import type { Order } from "@/lib/store";
import { OrderCard } from "./order-card";
import { SigningCard, type SigningOutput } from "./signing-card";
import { useWallet } from "./wallet";

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
  signing,
  orderId,
  onContinue,
  busy,
  signed,
  onSigned,
}: {
  /** The signature still owed, if any. */
  signing?: SigningOutput;
  /** The checkout's order, once it exists. */
  orderId?: string;
  onContinue: (text: string) => void;
  busy: boolean;
  signed?: boolean;
  onSigned?: (key: string) => void;
}) {
  const { wallet } = useWallet();
  const [order, setOrder] = useState<Order | undefined>(undefined);

  // The active order's state, polled here so it is read in exactly one place. Stops at
  // a terminal state, and starts over if the panel moves to a different order.
  const state = order?.state;
  useEffect(() => {
    if (!orderId) {
      setOrder(undefined);
      return;
    }
    if (state && TERMINAL_STATES.has(state)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/shop/orders/${orderId}`);
        if (cancelled || !res.ok) return;
        const body = (await res.json()) as { order?: Order };
        if (body.order) setOrder(body.order);
      } catch {
        // transient — the next tick retries
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [orderId, state]);

  // The order in state may be a previous one for a tick after orderId changes; only
  // trust its state when it is the order the panel was told about.
  const step = currentStep({
    hasWallet: !!wallet,
    pendingSigning: signing?.step,
    orderState: order?.id === orderId ? order?.state : undefined,
  });

  if (!step) return null;

  return (
    <div className="border-t border-neutral-200 pt-2 dark:border-neutral-800">
      <StepRow step={step} />
      <div className="mt-2">
        {signing ? (
          <SigningCard
            output={signing}
            onContinue={onContinue}
            busy={busy}
            signed={signed}
            onSigned={onSigned}
          />
        ) : orderId ? (
          // Live: this is the single polling card now, and it reads the order this
          // panel already fetched rather than opening a second loop.
          <OrderCard orderId={orderId} initial={order} live={false} />
        ) : null}
      </div>
    </div>
  );
}

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
