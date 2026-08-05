"use client";

import type { EveMessageInputRequest } from "eve/client";
import type { EveDynamicToolPart } from "eve/react";
import { useState } from "react";
import { asSigningOutput, SigningCard, signingKey } from "./signing-card";
import { orderCardOrderId, type ToolPart, ToolView } from "./tool-views";

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
  onRespond: (requestId: string, answer: { optionId?: string; text?: string }) => void;
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
  // A repeat status check for an order already shown. Only for an order OTHER than the
  // active one, which ToolView renders as a reference to the panel instead — this used
  // to say "the card above is live", pointing at a card that no longer exists now that
  // the panel below is the only live surface.
  if (
    part.state === "output-available" &&
    supersededCard &&
    orderCardOrderId(part.toolName, part.output) !== activeOrderId
  ) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-xs text-neutral-500 dark:border-neutral-700">
        status checked
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
    // No request metadata means there is nothing to answer — say so rather than render a
    // pair of buttons that resolve nothing.
    if (!request) {
      return (
        <div className="rounded-lg border border-amber-300 px-3 py-2 text-xs dark:border-amber-900">
          {part.toolName} — waiting for input, but the request details did not arrive.
        </div>
      );
    }
    return (
      <InputRequestCard
        request={request}
        toolName={part.toolName}
        busy={busy}
        onRespond={onRespond}
      />
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

/**
 * A pending `input.requested`, rendered by what it IS rather than by which state it
 * arrives in.
 *
 * Every request — a tool approval, an `ask_question`, a session-limit continuation —
 * projects to the same `approval-requested` part, and this used to render all three as one
 * amber "Approve running <tool>?" box with Approve/Deny. So the moment the agent asked a
 * clarifying question ("which size?"), the shopper was shown an approval prompt for
 * `ask_question` and had no way to type an answer.
 *
 * The docs say to route on the discriminator: "Each request includes a `kind`
 * discriminator: `tool-approval`, `question`, or `session-limit`. Clients should use `kind`
 * to choose behavior and presentation; `toolName` and `requestId` identify the action and
 * request but do not encode its semantics" (docs/tools/human-in-the-loop.md).
 *
 * `display` picks the control and `allowFreeform` decides whether typing is allowed
 * alongside the options, so a question with no options still gets a text field instead of
 * a dead end.
 */
function InputRequestCard({
  request,
  toolName,
  busy,
  onRespond,
}: {
  request: EveMessageInputRequest;
  toolName: string;
  busy: boolean;
  onRespond: (requestId: string, answer: { optionId?: string; text?: string }) => void;
}) {
  const [text, setText] = useState("");
  const isQuestion = request.kind === "question";
  const isLimit = request.kind === "session-limit";

  // A question is the agent talking, not a risk to sign off — only the two that gate
  // something get the amber treatment.
  const frame = isQuestion
    ? "rounded-lg border border-blue-300 px-3 py-2 dark:border-blue-900"
    : "rounded-lg border border-amber-300 px-3 py-2 dark:border-amber-900";
  const label = isQuestion ? "the agent is asking" : isLimit ? "session limit" : toolName;

  // Only an approval has a safe default pair to fall back on. Inventing Approve/Deny for a
  // question is what produced the original confusion, so a question with no options relies
  // on the text field below.
  const options =
    request.options ??
    (request.kind === "tool-approval"
      ? [
          { id: "approve", label: "Approve" },
          { id: "deny", label: "Deny" },
        ]
      : []);
  const canType = request.display === "text" || request.allowFreeform === true;

  return (
    <div className={frame}>
      <div className="flex items-center gap-2 font-mono text-[11px] text-neutral-400">
        <span
          className={
            isQuestion
              ? "size-2 animate-pulse rounded-full bg-blue-500"
              : "size-2 animate-pulse rounded-full bg-amber-500"
          }
        />
        {label}
      </div>
      <p className="mt-1 text-xs">{request.prompt}</p>

      {options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={busy}
              title={option.description}
              onClick={() => onRespond(request.requestId, { optionId: option.id })}
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
      )}

      {canType && (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const answer = text.trim();
            if (!answer) return;
            setText("");
            onRespond(request.requestId, { text: answer });
          }}
        >
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Type your answer…"
            className="flex-1 rounded-lg border border-neutral-300 bg-transparent px-2 py-1 text-xs outline-none focus:border-neutral-500 dark:border-neutral-700"
          />
          <button
            type="submit"
            disabled={busy || text.trim().length === 0}
            className="rounded-lg bg-neutral-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-black"
          >
            Answer
          </button>
        </form>
      )}
    </div>
  );
}
