"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { type ToolPart, ToolView } from "./tool-views";

const SUGGESTIONS = [
  "What's in the store?",
  "Find me a t-shirt under $3",
  "How can I pay?",
  "Show my orders",
];

// Where the transcript is parked while this page is unmounted. sessionStorage, not
// localStorage: the conversation has to survive a hop to /merchant and back, but a
// demo shown to the next person should start clean.
const TRANSCRIPT_KEY = "rail0-starter:chat";

export default function Chat() {
  const [input, setInput] = useState("");
  const { messages, setMessages, sendMessage, status, error, regenerate } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  // Capturing an order means leaving for /merchant, which unmounts this page — and
  // useChat keeps its messages in component state only, so the whole conversation
  // (mid-purchase) used to be gone on the way back. Restore once on mount, then
  // mirror every change. Restoring in an effect rather than seeding useChat keeps
  // the server render and the first client render identical (no hydration
  // mismatch); the cost is one frame of empty transcript.
  const restored = useRef(false);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(TRANSCRIPT_KEY);
      if (saved) setMessages(JSON.parse(saved));
    } catch {
      // corrupt or unavailable storage — start fresh rather than break the page
    }
    restored.current = true;
  }, [setMessages]);

  useEffect(() => {
    // Guard on `restored`: the first render has no messages yet, and writing that
    // empty array would wipe the transcript we are about to restore.
    if (!restored.current) return;
    try {
      if (messages.length > 0) {
        sessionStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(messages));
      } else {
        sessionStorage.removeItem(TRANSCRIPT_KEY);
      }
    } catch {
      // over quota or unavailable — the in-memory conversation still works
    }
  }, [messages]);

  const busy = status === "submitted" || status === "streaming";

  // Follow the stream: keep the transcript pinned to the bottom while new
  // tokens arrive, but only when the user is already there — scrolling up to
  // re-read something must not get yanked back down. The effect has no dep
  // array on purpose: streaming mutates message parts in place, so "every
  // render" is exactly the granularity that tracks it (and the live order
  // cards growing after the stream ends).
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

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    sendMessage({ text: trimmed });
    setInput("");
  };

  return (
    <main className="mx-auto flex h-[calc(100vh-53px)] max-w-4xl flex-col px-4">
      <div ref={scrollerRef} onScroll={onScroll} className="flex-1 space-y-4 overflow-y-auto py-6">
        {messages.length === 0 && (
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
        {messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "flex justify-end" : ""}>
            <div
              className={
                message.role === "user"
                  ? "max-w-[80%] rounded-2xl bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-neutral-100 dark:text-black"
                  : "space-y-2 text-sm"
              }
            >
              {message.parts.map((part, i) => {
                // Message parts carry no stable id, and the list is append-only
                // within a message — the index is the only usable key.
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
                if (part.type.startsWith("tool-")) {
                  // biome-ignore lint/suspicious/noArrayIndexKey: parts have no id
                  return <ToolView key={i} part={part as ToolPart} />;
                }
                return null;
              })}
            </div>
          </div>
        ))}
        {busy && <div className="text-sm text-neutral-400">the agent is working…</div>}
        {/* Without this the turn just vanishes: the SDK keeps stream failures in
            `error`, and a provider 529 is common enough to surface with a retry. */}
        {error && !busy && (
          <div className="flex items-center gap-3 rounded-lg border border-red-300 px-3 py-2 text-sm dark:border-red-900">
            <span className="text-red-600 dark:text-red-400">{error.message}</span>
            <button
              type="button"
              onClick={() => regenerate()}
              className="ml-auto rounded-lg border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              Retry
            </button>
          </div>
        )}
      </div>
      {messages.length > 0 && (
        <div className="flex justify-end pb-1">
          <button
            type="button"
            onClick={() => setMessages([])}
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

/**
 * The route streams reasoning (`sendReasoning: true`), but this page used to
 * drop those parts on the floor — render them collapsed so the agent's
 * thinking is inspectable without drowning the conversation.
 */
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
