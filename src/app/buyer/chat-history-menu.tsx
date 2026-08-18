"use client";

import { useState } from "react";
import { type ChatRecord, relativeTime } from "@/lib/chat-history";

/**
 * The way back into a conversation the page deliberately did not open on.
 *
 * The chat opens clean every time — a demo handed to the next person must not start
 * mid-sentence in someone else's cart. That is only tolerable if getting back is one
 * click, so this sits in the chat's own header rather than behind a settings page, and it
 * is present on the empty chat too: the empty chat is exactly where you notice you wanted
 * the previous one.
 *
 * Renders nothing when there is no history, so a first-ever visit shows no control for a
 * feature it has no content for.
 */
export function ChatHistoryMenu({
  chats,
  onResume,
  onForget,
}: {
  chats: readonly ChatRecord[];
  onResume: (chat: ChatRecord) => void;
  onForget: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (chats.length === 0) return null;

  // Read once per render rather than per row, so every "12 min ago" on one open menu is
  // measured from the same instant.
  const now = Date.now();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="rounded-full border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900"
      >
        Past chats
        <span className="ml-1.5 text-neutral-400">{chats.length}</span>
      </button>
      {open && (
        <>
          {/* A full-screen backdrop rather than a document listener: it closes the menu on
              any outside click, including one that lands on another control, and it is
              undone by unmounting instead of by remembering to remove a listener. */}
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 z-20 mt-1 w-80 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-950">
            <p className="border-b border-neutral-200 px-3 py-2 text-[11px] text-neutral-500 dark:border-neutral-800">
              Kept in this browser only — the last{" "}
              {chats.length === 1 ? "chat" : `${chats.length} chats`}.
            </p>
            <ul>
              {chats.map((chat) => (
                <li
                  key={chat.id}
                  className="flex items-center gap-2 border-b border-neutral-100 last:border-0 dark:border-neutral-900"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onResume(chat);
                    }}
                    className="flex-1 px-3 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  >
                    <span className="block truncate text-xs font-medium">{chat.title}</span>
                    <span className="block text-[11px] text-neutral-500">
                      {relativeTime(chat.savedAt, now)}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Forget "${chat.title}"`}
                    onClick={() => onForget(chat.id)}
                    className="px-3 py-2 text-xs text-neutral-400 hover:text-red-600 dark:hover:text-red-400"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
