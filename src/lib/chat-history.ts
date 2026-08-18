import type { ClientSessionState, MessageStreamEvent } from "eve/client";

/**
 * The buyer's past conversations, kept in the browser.
 *
 * Two things were true at once and only one of them was implemented: a demo shown to the
 * next person must open on a clean chat, and the person demoing it wants yesterday's
 * conversation back. The transcript used to live in sessionStorage precisely so it would
 * die with the tab — which delivered the clean open by throwing the history away.
 *
 * So: localStorage, and the clean open comes from WHAT IS MOUNTED rather than from what
 * survived. The list is offered and the reader picks.
 *
 * With ONE exception, and it is the demo's main gesture: hopping to /merchant to capture
 * and back is a full unmount of the buyer page, and returning to a blank chat read as
 * having lost the conversation. So the chat a VISIT is currently in is pointed at from
 * sessionStorage — which dies with the tab, exactly the scope the transcript used to have.
 * A new tab, or the next person, still gets a clean open; walking across the demo does not.
 *
 * Still no server store — this is the browser's own memory of its own chats, keyed by the
 * eve session id. The conversation itself is durable on the eve server; what is kept here
 * is the cursor to resume it plus the rendered event log to draw it with.
 */

/** The slice of the Storage API this module uses — so tests need no DOM. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ChatRecord {
  /** The eve session id: the durable conversation this record resumes. */
  id: string;
  /** When it was last written, epoch ms — the list's sort key. */
  savedAt: number;
  /** The reader's own words: the first thing they asked, trimmed. */
  title: string;
  events: readonly MessageStreamEvent[];
  session?: ClientSessionState;
}

export const HISTORY_KEY = "rail0-starter:eve-chats";

/**
 * Which conversation THIS VISIT is in — an id into the list above, held in sessionStorage.
 *
 * Deliberately a different storage than the list it points into. The list is the browser's
 * memory across visits (localStorage); this is one visit's place in it, and it must die
 * when the tab does or the next person inherits a chat mid-flight.
 */
export const CURRENT_KEY = "rail0-starter:eve-current";

/**
 * How many conversations to keep.
 *
 * Small on purpose. A transcript carries every rendered event of every turn, so a handful
 * of long chats is already hundreds of kilobytes against a ~5MB origin quota — and the
 * value of this list is "the one I was just in", not an archive. The oldest fall off.
 */
export const MAX_CHATS = 5;

/** The longest title worth keeping; the rest is a tooltip nobody reads. */
const MAX_TITLE = 80;

function isRecord(value: unknown): value is ChatRecord {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ChatRecord>;
  return typeof candidate.id === "string" && Array.isArray(candidate.events);
}

/**
 * Every kept conversation, newest first.
 *
 * Tolerant by design: a malformed or half-written entry is dropped rather than thrown,
 * because the failure mode of the alternative is a chat page that will not render at all
 * until someone clears their storage by hand. Anything unparseable reads as "no history".
 */
export function readHistory(storage: StorageLike): ChatRecord[] {
  let raw: string | null;
  try {
    raw = storage.getItem(HISTORY_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isRecord)
      .map((chat) => ({ ...chat, savedAt: typeof chat.savedAt === "number" ? chat.savedAt : 0 }))
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(0, MAX_CHATS);
  } catch {
    return [];
  }
}

/** A conversation's first words, as its name in the list. */
export function chatTitle(firstUserText: string | undefined): string {
  const text = (firstUserText ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "Untitled conversation";
  return text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1)}…` : text;
}

/**
 * Write one conversation into the list and return the list as it now stands.
 *
 * Upsert by session id, not append: a conversation is saved again after every turn, and
 * appending would fill the list with five copies of the chat you are currently in.
 *
 * On a quota error the OLDEST entry is dropped and the write retried, down to keeping
 * just this one. A transcript can outgrow the quota on its own (an agent turn carries
 * every tool call and its output), and the alternative to shedding history is failing to
 * save the conversation the reader is actually in.
 */
export function rememberChat(storage: StorageLike, chat: ChatRecord): ChatRecord[] {
  const others = readHistory(storage).filter((existing) => existing.id !== chat.id);
  let candidates = [chat, ...others].sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_CHATS);
  while (candidates.length > 0) {
    try {
      storage.setItem(HISTORY_KEY, JSON.stringify(candidates));
      return candidates;
    } catch {
      // Quota, or storage disabled entirely. Shed the oldest and try again; if even one
      // record will not fit, the chat still works — it is only the memory of it that is
      // lost, and the durable session lives on the server regardless.
      candidates = candidates.slice(0, -1);
    }
  }
  return [];
}

/** Forget one conversation, returning what is left. */
export function forgetChat(storage: StorageLike, id: string): ChatRecord[] {
  const kept = readHistory(storage).filter((chat) => chat.id !== id);
  try {
    if (kept.length === 0) storage.removeItem(HISTORY_KEY);
    else storage.setItem(HISTORY_KEY, JSON.stringify(kept));
  } catch {
    // nothing to do — the list in memory is what the caller renders
  }
  return kept;
}

/**
 * The conversation this visit is in, if any.
 *
 * Tolerant like readHistory, and for the same reason: storage can be disabled outright
 * (Safari private mode throws on access), and a page that will not render because it could
 * not read a resume hint is worse than one that opens clean.
 */
export function readCurrentChatId(storage: StorageLike): string | undefined {
  try {
    return storage.getItem(CURRENT_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Point this visit at a conversation — on resume, and on every save of the live one. */
export function setCurrentChatId(storage: StorageLike, id: string): void {
  try {
    storage.setItem(CURRENT_KEY, id);
  } catch {
    // Storage disabled or full. The chat still works; only the return-from-merchant
    // convenience is lost, which is the right thing to sacrifice here.
  }
}

/** Forget where this visit was — "New conversation", and deleting the chat you are in. */
export function clearCurrentChatId(storage: StorageLike): void {
  try {
    storage.removeItem(CURRENT_KEY);
  } catch {
    // as above
  }
}

/** "just now" / "12 min ago" / "3 days ago" — enough to tell two chats apart. */
export function relativeTime(savedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
