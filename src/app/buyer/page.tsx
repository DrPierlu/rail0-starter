"use client";

import type { MessageStreamEvent, SessionState } from "eve/client";
import { useEveAgent } from "eve/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { EveToolView } from "./eve-tool-view";
import { asSigningOutput, SigningCard, signingKey } from "./signing-card";
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
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <main className="mx-auto flex h-[calc(100vh-53px)] max-w-4xl flex-col px-4" />;
  }
  return (
    <WalletProvider>
      <EveChat />
    </WalletProvider>
  );
}

function EveChat() {
  const [input, setInput] = useState("");
  const [saved] = useState<SavedChat>(loadSaved);
  const { wallet } = useWallet();
  // Signing steps already signed in this tab. The pinned slot needs it to know when to
  // let go, and the transcript copies need it to render as done rather than offering a
  // second signature.
  const [signedKeys, setSignedKeys] = useState<ReadonlySet<string>>(() => new Set<string>());
  const onSigned = useCallback((key: string) => {
    setSignedKeys((current) => new Set(current).add(key));
  }, []);

  const agent = useEveAgent({
    initialEvents: saved.events ?? [],
    initialSession: saved.session,
    onFinish(snapshot) {
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

  // Every turn carries the connected wallet address as ephemeral client
  // context: checkout_begin needs it, and the model must never guess it.
  const sendText = (text: string) => {
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

  const respond = (requestId: string, optionId: string) => {
    void agent.send({ inputResponses: [{ requestId, optionId }] });
  };

  // Re-send the text of the last user message after a failed turn.
  const retry = () => {
    const lastUser = [...agent.data.messages].reverse().find((m) => m.role === "user");
    const text = lastUser?.parts.find((p) => p.type === "text")?.text;
    if (text) sendText(text);
  };

  const newConversation = () => {
    agent.reset();
    try {
      sessionStorage.removeItem(TRANSCRIPT_KEY);
    } catch {
      // nothing to clear
    }
  };

  // The signing step still waiting for a signature — the LAST one the agent produced
  // that has not been signed. Pinned below the wallet bar so it cannot scroll out of
  // reach: it is a chat message, and hunting back up the transcript to press Sign was
  // the whole annoyance. Signing it (or a later step arriving) clears the pin.
  const pending = useMemo(() => {
    let last: { key: string; output: ReturnType<typeof asSigningOutput> } | null = null;
    for (const message of agent.data.messages) {
      for (const part of message.parts) {
        if (part.type !== "dynamic-tool" || part.state !== "output-available") continue;
        const signing = asSigningOutput(part.output);
        if (!signing) continue;
        const key = signingKey(signing);
        last = signedKeys.has(key) ? null : { key, output: signing };
      }
    }
    return last;
  }, [agent.data.messages, signedKeys]);

  return (
    <main className="mx-auto flex h-[calc(100vh-53px)] max-w-4xl flex-col px-4">
      <div className="flex justify-end border-b border-neutral-200 py-2 dark:border-neutral-800">
        <WalletChip />
      </div>
      {pending?.output && (
        <div className="border-b border-neutral-200 py-2 dark:border-neutral-800">
          <SigningCard
            output={pending.output}
            onContinue={sendText}
            busy={busy}
            pinned
            onSigned={onSigned}
          />
        </div>
      )}
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
