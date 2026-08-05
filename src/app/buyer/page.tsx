"use client";

import type { MessageStreamEvent, SessionState } from "eve/client";
import { useEveAgent } from "eve/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { type CheckoutEvent, pendingSignature } from "@/lib/checkout-step";
import { CheckoutPanel } from "./checkout-panel";
import { EveToolView } from "./eve-tool-view";
import { asSigningOutput, signingKey } from "./signing-card";
import { orderCardOrderId } from "./tool-views";
import { useWallet, WalletChip, WalletProvider } from "./wallet";

const SUGGESTIONS = [
  "What's in the store?",
  "Find me a t-shirt under $3",
  "How can I pay?",
  "Show my orders",
];

// Where the conversation is parked while this page is unmounted (a hop to
// /merchant and back, a reload). The eve session itself is durable on the
// server; what we save is the resumable cursor plus the rendered event log.
// sessionStorage, not localStorage: a demo shown to the next person starts clean.
const TRANSCRIPT_KEY = "rail0-starter:eve-chat";

interface SavedChat {
  events?: readonly MessageStreamEvent[];
  session?: SessionState;
}

function loadSaved(): SavedChat {
  try {
    const raw = sessionStorage.getItem(TRANSCRIPT_KEY);
    return raw ? (JSON.parse(raw) as SavedChat) : {};
  } catch {
    return {};
  }
}

// useEveAgent reads its session options once, when it creates its store — so the
// component that calls it can only mount after sessionStorage has been read,
// which means client-side only. The outer page renders an empty shell during SSR
// and the first client render, then mounts the real chat.
export default function BuyerPage() {
  const [mounted, setMounted] = useState(false);
  // Bumped by "New conversation" to REMOUNT the chat. agent.reset() cannot do the job
  // on its own: the store's owned-session factory closes over the initialSession it was
  // built with —
  //   this.#e = e.session ? undefined : () => new Client({…}).session(e.initialSession)
  // — and Client.session(state) RESUMES that session, where session(undefined) creates a
  // fresh one. So reset() cleared the local events and then re-bound to the very same
  // durable session, which replayed its log on the next turn: the old conversation came
  // back and the newly typed message looked ignored.
  //
  // Remounting is what eve's own docs prescribe ("remount the component to point at a
  // different … session"): a new store reads sessionStorage again, finds it cleared, and
  // gets initialSession: undefined.
  const [epoch, setEpoch] = useState(0);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <main className="mx-auto flex h-[calc(100vh-53px)] max-w-4xl flex-col px-4" />;
  }
  return (
    <WalletProvider>
      <EveChat key={epoch} onNewConversation={() => setEpoch((e) => e + 1)} />
    </WalletProvider>
  );
}

function EveChat({ onNewConversation }: { onNewConversation: () => void }) {
  const [input, setInput] = useState("");
  const [saved] = useState<SavedChat>(loadSaved);
  const { wallet } = useWallet();
  // Signing steps already signed in this tab. The docked box needs it to know when to
  // let go, and the transcript copies need it to render as done rather than offering a
  // second signature.
  const [signedKeys, setSignedKeys] = useState<ReadonlySet<string>>(() => new Set<string>());
  const onSigned = useCallback((key: string) => {
    setSignedKeys((current) => new Set(current).add(key));
  }, []);

  // Set the instant a new conversation is requested. The turn being aborted can still
  // settle and call onFinish, which would write the OLD transcript back into
  // sessionStorage we just cleared — and the next reload would restore the very
  // conversation the user asked to leave.
  const discardedRef = useRef(false);

  const agent = useEveAgent({
    initialEvents: saved.events ?? [],
    initialSession: saved.session,
    onFinish(snapshot) {
      if (discardedRef.current) return;
      try {
        sessionStorage.setItem(
          TRANSCRIPT_KEY,
          JSON.stringify({ events: snapshot.events, session: snapshot.session }),
        );
      } catch {
        // over quota or unavailable — the durable session on the server survives
      }
    },
  });

  const busy = agent.status === "submitted" || agent.status === "streaming";

  // Follow the stream: keep the transcript pinned to the bottom while new
  // tokens arrive, but only when the user is already there — scrolling up to
  // re-read something must not get yanked back down.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  useEffect(() => {
    const el = scrollerRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  });
  const onScroll = () => {
    const el = scrollerRef.current;
    if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  // Re-arm the follow, because sending is the user saying "I am at the live end of this
  // conversation" — the clearest signal there is.
  //
  // pinnedRef only ever LATCHED off: onScroll turned it false as soon as you scrolled up
  // past the threshold, and nothing turned it back on. Correct while tokens stream (being
  // yanked down mid-read is the thing that guard exists to prevent), wrong the moment you
  // then type something: your own message landed below the fold and the whole reply
  // streamed off-screen. Every caller here is user-initiated — the composer, retry, the
  // signing cards' nudge, an approval — so all of them re-arm.
  const followStream = () => {
    pinnedRef.current = true;
  };

  // Every turn carries the connected wallet address as ephemeral client
  // context: checkout_begin needs it, and the model must never guess it.
  const sendText = (text: string) => {
    followStream();
    void agent.send({
      message: text,
      clientContext: wallet ? { buyer_wallet_address: wallet.address } : undefined,
    });
  };

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    sendText(trimmed);
    setInput("");
  };

  // An answer is either a chosen option or typed text — InputResponse carries both as
  // optional, and a question with allowFreeform (or display: "text") has no option to pick.
  const respond = (requestId: string, answer: { optionId?: string; text?: string }) => {
    followStream();
    void agent.send({ inputResponses: [{ requestId, ...answer }] });
  };

  // Re-send the text of the last user message after a failed turn.
  const retry = () => {
    const lastUser = [...agent.data.messages].reverse().find((m) => m.role === "user");
    const text = lastUser?.parts.find((p) => p.type === "text")?.text;
    if (text) sendText(text);
  };

  const newConversation = () => {
    // Order matters: refuse further writes, stop the stream, clear the parked
    // transcript, then remount — so nothing can re-save it on the way out.
    discardedRef.current = true;
    // stop() is LOCAL. "Detaching the stream never cancels the work — the turn keeps
    // running and billing on the server" (docs/guides/frontend/overview.mdx), so
    // abandoning a conversation mid-turn left it running to completion for nobody. Cancel
    // the turn on the server first.
    //
    // Fire and forget by design: the route answers "no_active_turn" for an unknown
    // session, a settled turn, or a duplicate cancel, and the docs call that a success —
    // "so a stop button can fire and forget". Nothing here should block on it, and a
    // failure must not stop the user leaving the conversation.
    const sessionId = agent.session?.sessionId;
    if (sessionId) {
      void fetch(`/eve/v1/session/${sessionId}/cancel`, { method: "POST" }).catch(() => {
        // the conversation is being abandoned either way
      });
    }
    agent.stop();
    try {
      sessionStorage.removeItem(TRANSCRIPT_KEY);
    } catch {
      // nothing to clear
    }
    onNewConversation();
  };

  // ONE walk of the transcript, producing everything the docked panel and the transcript
  // need. It was two walks that had to agree on what counts as "the current checkout";
  // deriving them together is what keeps them from disagreeing.
  //
  //   pending — the signature still owed. The LAST signing step the agent produced that
  //     has not been signed, and that the conversation has not already moved past.
  //
  //     `signedKeys` alone was not enough, and the failure was visible: it is component
  //     state, while the transcript is restored from sessionStorage, so after a reload
  //     every already-signed step looked unsigned again — the box offered to sign a
  //     payment the transcript itself showed as submitted and confirming. So the
  //     transcript is the authority: an order-card output for the SAME order appearing
  //     AFTER the signing step means the flow moved on, and the signature is done.
  //     signedKeys still matters for the moment between signing and the agent's next
  //     tool call, when the transcript has no such proof yet.
  //
  //   superseded — repeat OrderCards for the same order, by toolCallId. The agent calls
  //     order_status again and again while a payment confirms, and each output rendered
  //     its own card. Keyed on toolCallId, which dynamic-tool parts DO carry — the
  //     "parts have no stable id" note on the render loop below is about text parts.
  //
  //   lastOrderId — the checkout the panel is about, when no signature is owed.
  const { pending, superseded, lastOrderId } = useMemo(() => {
    const events: CheckoutEvent[] = [];
    const outputByKey = new Map<string, ReturnType<typeof asSigningOutput>>();
    const seen = new Map<string, string>();
    const superseded = new Set<string>();
    let lastOrderId: string | undefined;

    for (const message of agent.data.messages) {
      for (const part of message.parts) {
        if (part.type !== "dynamic-tool" || part.state !== "output-available") continue;

        const signing = asSigningOutput(part.output);
        if (signing) {
          const key = signingKey(signing);
          outputByKey.set(key, signing);
          events.push({ kind: "signing", key, orderId: signing.order_id });
          continue;
        }

        const orderId = orderCardOrderId(part.toolName, part.output);
        if (!orderId) continue;
        lastOrderId = orderId;
        if (seen.has(orderId)) superseded.add(part.toolCallId);
        else seen.set(orderId, part.toolCallId);
        events.push({ kind: "order", orderId });
      }
    }

    // The decision itself is pendingSignature (lib/checkout-step), not a copy of it here:
    // the precedence it encodes is what got this wrong once already, and a duplicate would
    // be the version no test covers.
    const owed = pendingSignature(events, signedKeys);
    const pending = owed ? { key: owed.key, output: outputByKey.get(owed.key) } : null;
    return { pending, superseded, lastOrderId };
  }, [agent.data.messages, signedKeys]);

  // A signature owed names its own order; otherwise it is the last one mentioned. This
  // is the order the panel goes live on, and the one the transcript stops duplicating.
  const activeOrderId = pending?.output?.order_id ?? lastOrderId;

  return (
    <main className="mx-auto flex h-[calc(100vh-53px)] max-w-4xl flex-col px-4">
      <div className="flex justify-end border-b border-neutral-200 py-2 dark:border-neutral-800">
        <WalletChip />
      </div>
      <div ref={scrollerRef} onScroll={onScroll} className="flex-1 space-y-4 overflow-y-auto py-6">
        {agent.data.messages.length === 0 && (
          <div className="pt-16 text-center">
            <h1 className="text-lg font-semibold">Shop with an AI agent, pay over rail0 escrow</h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-neutral-500">
              The agent browses the merchant&apos;s catalog, builds your cart, and pays in
              stablecoins. Funds sit in on-chain escrow until the merchant fulfils and captures the
              order.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s)}
                  className="rounded-full border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {agent.data.messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "flex justify-end" : ""}>
            <div
              className={
                message.role === "user"
                  ? "max-w-[80%] rounded-2xl bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-neutral-100 dark:text-black"
                  : "space-y-2 text-sm"
              }
            >
              {message.parts.map((part, i) => {
                // Parts carry no stable id and the list is append-only within a
                // message — the index is the only usable key.
                if (part.type === "text") {
                  return message.role === "user" ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: parts have no id
                    <span key={i}>{part.text}</span>
                  ) : (
                    // biome-ignore lint/suspicious/noArrayIndexKey: parts have no id
                    <Streamdown key={i}>{part.text}</Streamdown>
                  );
                }
                if (part.type === "reasoning") {
                  // biome-ignore lint/suspicious/noArrayIndexKey: parts have no id
                  return <Reasoning key={i} text={part.text} />;
                }
                if (part.type === "dynamic-tool") {
                  return (
                    <EveToolView
                      // biome-ignore lint/suspicious/noArrayIndexKey: parts have no id
                      key={i}
                      part={part}
                      onRespond={respond}
                      onContinue={sendText}
                      busy={busy}
                      pinnedKey={pending?.key ?? null}
                      signedKeys={signedKeys}
                      onSigned={onSigned}
                      supersededCard={superseded.has(part.toolCallId)}
                      activeOrderId={activeOrderId}
                    />
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}
        {busy && <div className="text-sm text-neutral-400">the agent is working…</div>}
        {agent.status === "error" && (
          <div className="flex items-center gap-3 rounded-lg border border-red-300 px-3 py-2 text-sm dark:border-red-900">
            <span className="text-red-600 dark:text-red-400">
              {agent.error?.message || "The agent hit an unexpected error — retry in a moment."}
            </span>
            <button
              type="button"
              onClick={retry}
              className="ml-auto rounded-lg border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              Retry
            </button>
          </div>
        )}
      </div>
      {agent.data.messages.length > 0 && (
        <div className="flex justify-end pb-1">
          <button
            type="button"
            onClick={newConversation}
            className="text-xs text-neutral-400 hover:text-neutral-600 hover:underline dark:hover:text-neutral-300"
          >
            New conversation
          </button>
        </div>
      )}
      {/* Everything actionable or live lives here, docked to the composer.
          It used to sit at the TOP, which is what made the flow feel like it jumped:
          you read the newest message at the bottom, then the thing to act on was at the
          other end of the screen, then the reply came back at the bottom again. And it
          was not even the only live surface — the order status polled away in a card a
          few messages up. One box, one position, one thing at a time. */}
      <CheckoutPanel
        signing={pending?.output ?? undefined}
        orderId={activeOrderId}
        onContinue={sendText}
        busy={busy}
        signed={pending ? signedKeys.has(pending.key) : undefined}
        onSigned={onSigned}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="sticky bottom-0 flex gap-2 border-t border-neutral-200 bg-[var(--background)] py-3 dark:border-neutral-800"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the agent to shop for you…"
          className="flex-1 rounded-xl border border-neutral-300 bg-transparent px-4 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-xl bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-black"
        >
          Send
        </button>
      </form>
    </main>
  );
}

/** The agent's thinking, rendered collapsed so it is inspectable without noise. */
function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className="text-xs text-neutral-400">
      <button type="button" onClick={() => setOpen((o) => !o)} className="italic hover:underline">
        {open ? "hide thinking" : "thinking…"}
      </button>
      {open && (
        <p className="mt-1 whitespace-pre-wrap border-l-2 border-neutral-200 pl-2 dark:border-neutral-800">
          {text}
        </p>
      )}
    </div>
  );
}
