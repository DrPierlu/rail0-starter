"use client";

import { useState } from "react";
import {
  escrowSteps,
  IN_FLIGHT_STATES,
  STATE_STYLES,
  shortId,
  stateLabel,
  waitExplainer,
} from "@/lib/order-ui";
import type { OrderState } from "@/lib/order-view";

// Small client-side pieces shared by the buyer chat and the merchant page.

/** Order-state pill; in-flight states pulse to show a broadcast is pending. */
export function StateBadge({ state }: { state: OrderState }) {
  const inFlight = IN_FLIGHT_STATES.has(state);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLES[state] ?? ""}`}
    >
      {inFlight && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {stateLabel(state)}
    </span>
  );
}

/** Truncated rail0 id that copies the full value on click. */
export function CopyableId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy the full rail0 id"
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="font-mono text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
    >
      {copied ? "copied ✓" : shortId(value)}
    </button>
  );
}

/**
 * Where the order's money is, as three custodians (#1).
 *
 * Deliberately not a progress bar: a bar says "how far along", and the point here is
 * WHO HOLDS THE FUNDS — the buyer, the contract's escrow, or the merchant. The amount is
 * printed under the custodian that has it, so the demo shows escrow existing rather than
 * describing it. The dot pulses on the step the funds are leaving, which is the only
 * moment anything is genuinely in flight.
 *
 * The explainer below it exists because the wait got longer on purpose: notifies now
 * follow the chain's own settled block, so minutes are normal and silence would read as
 * a hang.
 */
export function EscrowTrail({
  state,
  amount,
  symbol,
}: {
  state: OrderState;
  amount: string;
  symbol: string;
}) {
  const steps = escrowSteps(state);
  const explainer = waitExplainer(state);
  return (
    <div>
      <ol className="flex items-stretch gap-1">
        {steps.map((step) => (
          <li key={step.custodian} className="flex-1">
            <div
              className={`h-0.5 rounded-full ${
                step.done ? "bg-blue-500/70" : "bg-neutral-200 dark:bg-neutral-800"
              }`}
            />
            <div className="mt-1.5 flex items-center gap-1.5">
              <span
                className={`size-1.5 rounded-full ${
                  step.moving
                    ? "animate-pulse bg-amber-500"
                    : step.current
                      ? "bg-blue-500"
                      : step.done
                        ? "bg-blue-500/40"
                        : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              />
              <span
                className={`text-[11px] ${
                  step.current
                    ? "font-medium text-neutral-700 dark:text-neutral-200"
                    : "text-neutral-400"
                }`}
              >
                {step.label}
              </span>
            </div>
            {step.current && (
              <p className="mt-0.5 pl-3 text-[11px] font-semibold tabular-nums">
                {amount} {symbol}
              </p>
            )}
          </li>
        ))}
      </ol>
      {explainer && <p className="mt-2 text-[11px] leading-snug text-neutral-500">{explainer}</p>}
    </div>
  );
}

/**
 * The chain an order lives on, as a chip beside its amount.
 *
 * It reads as decoration and is not: the chain decides which token's `decimals` the
 * amount was computed with, and how long settlement takes — the two facts that make
 * every other number on the card legible. It was available only as grey micro-copy in a
 * meta row, and it is available at all on list rows only since rail0-gateway#193 put
 * `chain_id` there.
 */
export function ChainChip({ name }: { name?: string }) {
  if (!name) return null;
  return (
    <span className="rounded-full bg-neutral-500/10 px-2 py-0.5 text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
      {name}
    </span>
  );
}
