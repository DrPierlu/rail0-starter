"use client";

import { useState } from "react";
import { IN_FLIGHT_STATES, STATE_STYLES, shortId, stateLabel } from "@/lib/order-ui";
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
