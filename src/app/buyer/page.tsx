"use client";

import { useEveAgent } from "eve/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import {
  type ChatRecord,
  chatTitle,
  clearCurrentChatId,
  forgetChat,
  readCurrentChatId,
  readHistory,
  rememberChat,
  setCurrentChatId,
} from "@/lib/chat-history";
import { type CheckoutEvent, pendingCheckout } from "@/lib/checkout-step";
import { pickSuggestions } from "@/lib/suggestions";
import { BudgetChip } from "./budget-chip";
import { ChatHistoryMenu } from "./chat-history-menu";
import { asCheckoutOutput, checkoutKey } from "./checkout-card";
import { CheckoutPanel } from "./checkout-panel";
import { EveToolView } from "./eve-tool-view";
import { orderCardOrderId } from "./tool-views";
import { WalletChip, WalletProvider } from "./wallet";

// Conversations are kept in localStorage and the clean open comes from what the page
// mounts, not from what the browser threw away (see lib/chat-history). The eve session
// itself is durable on the server; a record holds the cursor to resume it plus the
// rendered event log to draw it with.
//
// What this mount opens on is decided by a sessionStorage pointer: set, this visit was
// already in a conversation (it went to /merchant and came back — a full unmount) and
// that one reopens; absent, this is a fresh tab and the chat opens clean.

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
  // Which past conversation the mounted chat was opened on, if any. Undefined means a
  // clean chat: the first open of a TAB, even though the history below outlived the last.
  const [resumed, setResumed] = useState<ChatRecord | undefined>(undefined);
  // The list itself lives HERE, in the component that survives the remount, so resuming
  // or starting over does not re-read storage and cannot show a stale count.
  const [history, setHistory] = useState<readonly ChatRecord[]>([]);
  // ONE effect, because the two reads answer one question — what should this mount open
  // on? Both setStates land before EveChat first mounts (it waits on `allowed`, which is
  // a fetch), so the chat is built with its `initial` already resolved and never has to
  // be remounted to pick it up.
  useEffect(() => {
    const chats = readHistory(localStorage);
    setHistory(chats);
    const current = readCurrentChatId(sessionStorage);
    // A pointer at a chat that is no longer in the list (evicted at MAX_CHATS, or
    // forgotten in another tab) resolves to undefined — which opens clean, the same
    // answer as no pointer at all.
    if (current) setResumed(chats.find((chat) => chat.id === current));
  }, []);
  // Whether this visitor may talk to the agent at all. Undefined until asked, so the
  // page shows neither the chat nor a sign-in form while it does not know — a form
  // that flashes and vanishes reads as a bug.
  const [allowed, setAllowed] = useState<boolean | undefined>(undefined);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/buyer/session");
        const body = (await res.json()) as { signed_in?: boolean; required?: boolean };
        // Not required is the local dev server, where eve's own localDev() opens the
        // channel: asking for a token there would gate a chat that works.
        if (!cancelled) setAllowed(body.required === false || body.signed_in === true);
      } catch {
        // Unreachable route: assume a sign-in is needed rather than dropping the
        // visitor into a chat whose first message would 401 with no explanation.
        if (!cancelled) setAllowed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!mounted || allowed === undefined) {
    return <main className="mx-auto flex h-[calc(100vh-53px)] max-w-4xl flex-col px-4" />;
  }
  if (!allowed) return <BuyerSignIn onSignedIn={() => setAllowed(true)} />;
  return (
    <WalletProvider>
      <EveChat
        key={epoch}
        initial={resumed}
        history={history}
        onHistoryChange={setHistory}
        onResume={(chat) => {
          setCurrentChatId(sessionStorage, chat.id);
          setResumed(chat);
          setEpoch((e) => e + 1);
        }}
        onNewConversation={() => {
          // Clear the pointer BEFORE remounting: the fresh chat writes its own the moment
          // it has a session id, and leaving the old one up until then would reopen the
          // abandoned conversation if the visitor hopped to /merchant in between.
          clearCurrentChatId(sessionStorage);
          setResumed(undefined);
          setEpoch((e) => e + 1);
        }}
      />
    </WalletProvider>
  );
}

/**
 * The chat's sign-in.
 *
 * The agent can spend when the deployment holds a wallet, and the approval that gates
 * that spending is answered over the same channel — so this is not decoration in front
 * of a demo. It asks for BUYER_TOKEN and the server puts it in an httpOnly cookie; the
 * page never holds the credential after the submit.
 */
function BuyerSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/buyer/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        // Keeps the server's message: the 500 that names an unset BUYER_TOKEN is the
        // one worth reading, and no amount of retyping would fix it.
        setError(body.error ?? "sign-in failed");
        return;
      }
      setToken("");
      onSignedIn();
    } catch {
      setError("sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-sm px-4 py-20">
      <h1 className="text-lg font-semibold">Sign in to the agent</h1>
      <p className="mt-2 text-sm text-neutral-500">
        The value of <code className="font-mono">BUYER_TOKEN</code> on the server. The agent can pay
        from this deployment&apos;s wallet, so the chat is gated on it.
      </p>
      <form onSubmit={submit} className="mt-6">
        <label htmlFor="buyer-token" className="sr-only">
          Buyer token
        </label>
        <input
          id="buyer-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-950"
        />
        <button
          type="submit"
          disabled={busy || token.length === 0}
          className="mt-3 w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-black"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </main>
  );
}

function EveChat({
  initial,
  history,
  onHistoryChange,
  onResume,
  onNewConversation,
}: {
  initial?: ChatRecord;
  history: readonly ChatRecord[];
  onHistoryChange: (chats: readonly ChatRecord[]) => void;
  onResume: (chat: ChatRecord) => void;
  onNewConversation: () => void;
}) {
  const [input, setInput] = useState("");
  // Four prompts drawn fresh from the pool on every mount, so the empty chat does not
  // always open with the same four. In a lazy useState initializer, NOT at module
  // scope: module scope evaluates once per page load and would freeze the row for the
  // whole session, and "New conversation" remounts this component (see the `epoch` key
  // above), so the draw follows a reset for free. Re-rendering must not reshuffle
  // either — chips moving under a cursor about to click one is its own bug.
  //
  // Math.random() during render is safe here only because this component is
  // client-only: BuyerPage renders an empty shell until `mounted`, so EveChat never
  // renders on the server and there is no markup for the client to disagree with.
  const [suggestions] = useState(() => pickSuggestions(4));
  // Checkouts finished in this tab. The docked box needs it to know when to let go, and
  // the transcript stub needs it to read as done rather than as still waiting.
  const [doneKeys, setDoneKeys] = useState<ReadonlySet<string>>(() => new Set<string>());
  const onDone = useCallback((key: string) => {
    setDoneKeys((current) => new Set(current).add(key));
  }, []);

  // Set the instant a new conversation is requested. The turn being aborted can still
  // settle and call onFinish, which would write the OLD transcript back into
  // sessionStorage we just cleared — and the next reload would restore the very
  // conversation the user asked to leave.
  const discardedRef = useRef(false);

  // The conversation's name in the history list: the first thing the reader asked. Taken
  // as they send it rather than read back out of the transcript, because onFinish sees a
  // snapshot and not this component's rendered messages — and a resumed chat keeps the
  // title it already had rather than being renamed by its next turn.
  const titleRef = useRef<string | undefined>(initial?.title);

  // Write the live conversation into the list, and point this visit at it.
  //
  // Shared by the two moments a chat must become findable: every finished turn, and the
  // instant a brand-new session gets its id. Saving ONLY at onFinish is what made a first
  // turn interrupted by a hop to /merchant vanish outright — the unmount takes onFinish
  // with it, so nothing ever recorded the id, while the turn itself kept running (and
  // billing) on the eve server with nobody able to reach it again.
  const save = useCallback(
    (chat: Pick<ChatRecord, "id" | "events" | "session">) => {
      setCurrentChatId(sessionStorage, chat.id);
      onHistoryChange(
        rememberChat(localStorage, {
          ...chat,
          savedAt: Date.now(),
          title: chatTitle(titleRef.current),
        }),
      );
    },
    [onHistoryChange],
  );

  const agent = useEveAgent({
    initialEvents: initial?.events ?? [],
    initialSession: initial?.session,
    onFinish(snapshot) {
      if (discardedRef.current) return;
      // Keyed by the eve session id, so the per-turn save updates one record instead of
      // filling the list with copies of the chat in progress. No id (a turn that failed
      // before the session existed) means there is nothing resumable to keep.
      const id = snapshot.session?.sessionId ?? initial?.id;
      if (!id) return;
      save({ id, events: snapshot.events, session: snapshot.session });
    },
  });

  // Registration, not saving: the id is what makes the conversation reachable again, and
  // it exists from the first turn's start — long before that turn ends. Keyed on the id
  // ALONE on purpose. The transcript is written by onFinish; re-running this as events
  // arrive would serialize the whole log into localStorage on every token, and the record
  // it would write mid-stream is one no reader ever asked to keep.
  const sessionId = agent.session?.sessionId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the id appearing, not on the transcript
  useEffect(() => {
    if (!sessionId || discardedRef.current) return;
    save({ id: sessionId, events: agent.events, session: agent.session });
  }, [sessionId, save]);

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

  // No client context. The wallet address used to ride every turn because checkout_begin
  // took one — and a model that did not copy it into the tool input produced "no wallet
  // connected" for a shopper whose wallet was connected and on screen. The card reads the
  // wallet directly now (it is the only thing that signs), so the agent needs neither the
  // address nor a way to be wrong about it.
  const sendText = (text: string) => {
    followStream();
    titleRef.current ??= text;
    void agent.send(text);
  };

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    sendText(trimmed);
    setInput("");
  };

  // An answer is either a chosen option or typed text — InputResponse carries both as
  // optional, and a question with allowFreeform (or display: "text") has no option to pick.
  //
  // `respond`, not `send`: eve 0.31 split answering a pending request out of the message
  // path, and the two are now mutually exclusive. Sending `{ inputResponses }` as a
  // message no longer type-checks, and an approval answered that way would have read as
  // ordinary text.
  const respond = (requestId: string, answer: { optionId?: string; text?: string }) => {
    followStream();
    void agent.respond([{ requestId, ...answer }]);
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
    // Nothing is deleted here any more. Leaving a conversation used to erase it, which is
    // how "start clean" and "keep my chats" ended up mutually exclusive; the fresh chat
    // now comes from remounting on no record, and this one stays in the list.
    onNewConversation();
  };

  // ONE walk of the transcript, producing everything the docked panel and the transcript
  // need. It was two walks that had to agree on what counts as "the current checkout";
  // deriving them together is what keeps them from disagreeing.
  //
  //   pending — the checkout still in flight. The LAST one the agent started that has
  //     not finished, and that the conversation has not already moved past.
  //
  //     `doneKeys` alone was not enough, and the failure was visible: it is component
  //     state, while the transcript is restored from sessionStorage, so after a reload a
  //     finished checkout looked unfinished again — the box offered to sign a payment
  //     the transcript itself showed as confirming. So the transcript is the authority:
  //     an order-card output appearing AFTER the checkout step means the flow moved on,
  //     because an order only exists once that checkout created it. doneKeys still
  //     matters for the moment between the card finishing and the agent's next tool
  //     call, when the transcript has no such proof yet.
  //
  //   superseded — repeat OrderCards for the same order, by toolCallId. The agent calls
  //     order_status again and again while a payment confirms, and each output rendered
  //     its own card. Keyed on toolCallId, which dynamic-tool parts DO carry — the
  //     "parts have no stable id" note on the render loop below is about text parts.
  //
  //   lastOrderId — the checkout the panel is about, when no signature is owed.
  const { pending, superseded, lastOrderId } = useMemo(() => {
    const events: CheckoutEvent[] = [];
    const outputByKey = new Map<string, ReturnType<typeof asCheckoutOutput>>();
    const seen = new Map<string, string>();
    const superseded = new Set<string>();
    let lastOrderId: string | undefined;

    for (const message of agent.data.messages) {
      for (const part of message.parts) {
        if (part.type !== "dynamic-tool" || part.state !== "output-available") continue;

        const checkout = asCheckoutOutput(part.output);
        if (checkout) {
          const key = checkoutKey(checkout);
          outputByKey.set(key, checkout);
          events.push({ kind: "checkout", key });
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

    // The decision itself is pendingCheckout (lib/checkout-step), not a copy of it here:
    // the precedence it encodes is what got this wrong once already, and a duplicate would
    // be the version no test covers.
    const owed = pendingCheckout(events, doneKeys);
    const pending = owed ? { key: owed.key, output: outputByKey.get(owed.key) } : null;
    return { pending, superseded, lastOrderId };
  }, [agent.data.messages, doneKeys]);

  // The last order the conversation mentioned: what the panel goes live on once the
  // card has created it, and the one the transcript stops duplicating. A checkout in
  // flight has no order yet — the card reports its payment to the panel directly.
  const activeOrderId = lastOrderId;

  return (
    <main className="mx-auto flex h-[calc(100vh-53px)] max-w-4xl flex-col px-4">
      <div className="flex items-center justify-between gap-4 border-b border-neutral-200 py-2 dark:border-neutral-800">
        {/* The agent's ceiling, consumed live — the demo's answer to "how does an AI pay
            without being given a card". Left of the wallet on purpose: it is about the
            wallet's ALLOWANCE, and it is the more interesting of the two. */}
        <BudgetChip />
        {/* ml-auto and not justify-between alone: the budget chip renders nothing when the
            deployment has no wallet of its own, and this group then drifted to the left
            edge — taking its right-anchored menu off-screen with it. */}
        <div className="ml-auto flex items-center gap-2">
          {/* The way back into a conversation this page deliberately did not open on. In
              the header and not in the footer beside "New conversation": the footer only
              exists once there are messages, and the empty chat is exactly where you
              realise you wanted the previous one. */}
          <ChatHistoryMenu
            chats={history}
            onResume={onResume}
            onForget={(id) => {
              // Deleting the conversation this visit points at leaves a dangling pointer.
              // Harmless on mount (it resolves to undefined and opens clean) but cleared
              // here anyway, so "forget this chat" leaves nothing of it behind.
              if (readCurrentChatId(sessionStorage) === id) clearCurrentChatId(sessionStorage);
              onHistoryChange(forgetChat(localStorage, id));
            }}
          />
          <WalletChip />
        </div>
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
              {suggestions.map((s) => (
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
                      busy={busy}
                      pendingKey={pending?.key ?? null}
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
        checkout={pending?.output ?? undefined}
        orderId={activeOrderId}
        onContinue={sendText}
        onDone={onDone}
        busy={busy}
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
