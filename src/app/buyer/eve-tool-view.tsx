"use client";

import type { EveDynamicToolPart } from "eve/react";
import { asSigningOutput, SigningCard, signingKey } from "./signing-card";
import { type ToolPart, ToolView } from "./tool-views";

// Bridge between eve's `dynamic-tool` parts and the rich tool views built for
// the AI SDK variant. The lifecycle states line up one-to-one, so everything
// except the approval flow is a rename — which keeps tool-views.tsx identical
// across the two branches. The two checkout signing steps get their own card:
// the browser wallet signs, and the signature goes to the storefront stash,
// never through the chat.

export function EveToolView({
  part,
  onRespond,
  onContinue,
  busy,
  pinnedKey = null,
  signedKeys,
  onSigned,
  supersededCard = false,
  activeOrderId,
}: {
  part: EveDynamicToolPart;
  /** Answer a pending HITL request (approve/deny). */
  onRespond: (requestId: string, optionId: string) => void;
  /** Send a chat message (the signing cards nudge the agent onward with it). */
  onContinue: (text: string) => void;
  busy: boolean;
  /** The signing step currently held in the pinned slot, if any. */
  pinnedKey?: string | null;
  /** Signing steps already signed, so a transcript copy renders as done. */
  signedKeys?: ReadonlySet<string>;
  onSigned?: (key: string) => void;
  /** An OrderCard for an order already shown earlier in the transcript. */
  supersededCard?: boolean;
  /** The order the docked panel is live on. */
  activeOrderId?: string;
}) {
  // A repeat status check for an order already on screen. The card kept is the first
  // one, where the payment happened, and it polls itself — so a second card could only
  // duplicate it, and its polling. The check is still worth showing as a line.
  if (part.state === "output-available" && supersededCard) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-xs text-neutral-500 dark:border-neutral-700">
        ↑ status checked — the card above is live
      </div>
    );
  }

  if (part.state === "output-available") {
    const signing = asSigningOutput(part.output);
    if (signing) {
      const key = signingKey(signing);
      // The pinned slot holds the ONE interactive instance of a pending step. Rendering
      // the card here as well would give the same step two independent `state`s, so
      // signing in one would leave the other still offering to sign. A stub points up
      // instead, and the transcript keeps its place in the conversation.
      if (key === pinnedKey) {
        return (
          <div className="rounded-lg border border-dashed border-blue-300 px-3 py-1.5 text-xs text-neutral-500 dark:border-blue-900">
            ↓ {signing.step === "sign_login" ? "Sign in as the buyer" : "Sign the payment"} —
            waiting for your signature, in the box above the message field
          </div>
        );
      }
      return (
        <SigningCard
          output={signing}
          onContinue={onContinue}
          busy={busy}
          signed={signedKeys?.has(key)}
          onSigned={onSigned}
        />
      );
    }
  }

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
  return <ToolView part={mapped} activeOrderId={activeOrderId} />;
}
