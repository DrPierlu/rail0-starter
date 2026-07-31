"use client";

import type { EveDynamicToolPart } from "eve/react";
import { type ToolPart, ToolView } from "./tool-views";

// Bridge between eve's `dynamic-tool` parts and the rich tool views built for
// the AI SDK variant. The lifecycle states line up one-to-one, so everything
// except the approval flow is a rename — which keeps tool-views.tsx identical
// across the two branches.

export function EveToolView({
  part,
  onRespond,
  busy,
}: {
  part: EveDynamicToolPart;
  /** Answer a pending HITL request (approve/deny the checkout). */
  onRespond: (requestId: string, optionId: string) => void;
  busy: boolean;
}) {
  if (part.state === "approval-requested") {
    const request = part.toolMetadata?.eve?.inputRequest;
    return (
      <div className="rounded-lg border border-amber-300 px-3 py-2 dark:border-amber-900">
        <div className="flex items-center gap-2 font-mono text-[11px] text-neutral-400">
          <span className="size-2 animate-pulse rounded-full bg-amber-500" />
          {part.toolName}
        </div>
        <p className="mt-1 text-xs">{request?.prompt ?? `Approve running ${part.toolName}?`}</p>
        <div className="mt-2 flex gap-2">
          {(
            request?.options ?? [
              { id: "approve", label: "Approve" },
              { id: "deny", label: "Deny" },
            ]
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={busy || !request}
              onClick={() => request && onRespond(request.requestId, option.id)}
              className={
                option.style === "danger" || option.id === "deny"
                  ? "rounded-lg border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900"
                  : "rounded-lg bg-neutral-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-black"
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (part.state === "approval-responded") {
    return (
      <div className="rounded-lg border border-neutral-200 px-3 py-1.5 font-mono text-xs text-neutral-500 dark:border-neutral-800">
        <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-amber-500 align-middle" />
        {part.toolName} — {part.approval.approved === false ? "denied" : "approved, running…"}
      </div>
    );
  }

  if (part.state === "output-denied") {
    return (
      <div className="rounded-lg border border-neutral-200 px-3 py-1.5 font-mono text-xs text-neutral-500 dark:border-neutral-800">
        {part.toolName} — not run (denied)
      </div>
    );
  }

  // The remaining states are exactly the AI SDK ones; re-shape and reuse.
  const mapped: ToolPart = {
    type: `tool-${part.toolName}`,
    state: part.state,
    input: part.input,
    output: part.state === "output-available" ? part.output : undefined,
    errorText: part.state === "output-error" ? part.errorText : undefined,
  };
  return <ToolView part={mapped} />;
}
