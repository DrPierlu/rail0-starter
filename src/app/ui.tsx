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
 * A chain's mark: its own colour, and two letters standing in for its logo.
 *
 * Letters and not the brands' own artwork, deliberately. A template that ships five
 * companies' logos ships five trademark questions with them, and an icon in a demo is
 * not worth that — the colour is what the eye actually sorts a list by, and it needs no
 * permission. Swap these for the real marks in your own deployment if you have the right
 * to; the shape of this map is the seam for it.
 *
 * Keyed by chain id rather than name, because the name is the gateway's label and can be
 * edited in seeds without anything here noticing.
 */
const CHAIN_MARKS: Record<number, { initials: string; className: string }> = {
  5042002: { initials: "AR", className: "bg-[#0a5aff] text-white" }, // Arc Testnet
  84532: { initials: "BA", className: "bg-[#0052ff] text-white" }, // Base Sepolia
  11155420: { initials: "OP", className: "bg-[#ff0420] text-white" }, // Optimism Sepolia
  421614: { initials: "AB", className: "bg-[#12aaff] text-white" }, // Arbitrum Sepolia
  80002: { initials: "PO", className: "bg-[#8247e5] text-white" }, // Polygon Amoy
};

/**
 * The mark to draw for a chain, known or not.
 *
 * A chain missing from the map still gets one, in neutral grey with initials from the
 * words of its name ("Foo Sepolia" → FS): a hole in a column of coloured dots reads as a
 * rendering failure, which is worse than a plain dot. New chains arrive by a seeds edit in
 * the gateway, not by a release of this app, so that path is the normal one.
 */
export function chainMark(
  chainId: number | undefined,
  label: string,
): { initials: string; className: string } {
  const known = chainId === undefined ? undefined : CHAIN_MARKS[chainId];
  if (known) return known;
  const words = label.trim().split(/\s+/).filter(Boolean);
  const initials =
    words.length === 0
      ? "??"
      : words.length === 1
        ? words[0].slice(0, 2).toUpperCase()
        : `${words[0][0]}${words[1][0]}`.toUpperCase();
  return { initials, className: "bg-neutral-400 text-white dark:bg-neutral-600" };
}

/**
 * The chain an order lives on, as a chip beside its amount.
 *
 * It reads as decoration and is not: the chain decides which token's `decimals` the
 * amount was computed with, and how long settlement takes — the two facts that make
 * every other number on the card legible. It was available only as grey micro-copy in a
 * meta row, and it is available at all on list rows only since rail0-gateway#193 put
 * `chain_id` there.
 *
 * The mark carries the same information as the label, one glance earlier: down a list of
 * orders on two chains, colour separates them without reading a word. The label stays —
 * "Base Sepolia" and "Base" are not the same chain, and no dot can say which one this is.
 */
export function ChainChip({ chainId, name }: { chainId?: number; name?: string }) {
  const label = name ?? (chainId === undefined ? undefined : `chain ${chainId}`);
  if (!label) return null;
  const mark = chainMark(chainId, label);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-500/10 py-0.5 pr-2 pl-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
      {/* aria-hidden: the label right beside it says the same thing, and a screen reader
          reading "AR Arc Testnet" is worse than one reading "Arc Testnet". */}
      <span
        aria-hidden="true"
        className={`inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold leading-none tracking-tight ${mark.className}`}
      >
        {mark.initials}
      </span>
      {label}
    </span>
  );
}
