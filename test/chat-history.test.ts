import { beforeEach, describe, expect, it } from "vitest";
import {
  type ChatRecord,
  chatTitle,
  forgetChat,
  HISTORY_KEY,
  MAX_CHATS,
  readHistory,
  relativeTime,
  rememberChat,
  type StorageLike,
} from "@/lib/chat-history";

/**
 * The buyer's chat history.
 *
 * What this pins is the pair of requirements that used to be mutually exclusive: the chat
 * opens clean (nothing here resumes anything on its own — that is the page's mount) and
 * the conversations survive the tab that held them.
 */

class FakeStorage implements StorageLike {
  readonly map = new Map<string, string>();
  /** Set to fail writes, as a browser at quota does. */
  quota = Number.POSITIVE_INFINITY;

  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (value.length > this.quota) throw new Error("QuotaExceededError");
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

function chat(id: string, savedAt: number, title = `chat ${id}`): ChatRecord {
  return { id, savedAt, title, events: [] };
}

let storage: FakeStorage;
beforeEach(() => {
  storage = new FakeStorage();
});

describe("readHistory", () => {
  it("is empty before anything is kept, and newest-first after", () => {
    expect(readHistory(storage)).toEqual([]);
    rememberChat(storage, chat("a", 1000));
    rememberChat(storage, chat("b", 2000));
    expect(readHistory(storage).map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("reads as no history rather than throwing on junk", () => {
    // The alternative is a chat page that will not render until someone clears their
    // storage by hand.
    storage.setItem(HISTORY_KEY, "{not json");
    expect(readHistory(storage)).toEqual([]);
    storage.setItem(HISTORY_KEY, JSON.stringify({ nope: true }));
    expect(readHistory(storage)).toEqual([]);
    storage.setItem(HISTORY_KEY, JSON.stringify([{ id: "x" }, chat("ok", 5)]));
    expect(readHistory(storage).map((c) => c.id)).toEqual(["ok"]);
  });
});

describe("rememberChat", () => {
  it("updates one record per conversation instead of appending copies", () => {
    // A chat is saved after every turn; appending would fill the list with the chat you
    // are still in.
    rememberChat(storage, chat("a", 1000, "first ask"));
    rememberChat(storage, chat("a", 2000, "first ask"));
    const kept = readHistory(storage);
    expect(kept).toHaveLength(1);
    expect(kept[0].savedAt).toBe(2000);
  });

  it("keeps only the newest MAX_CHATS", () => {
    for (let i = 0; i < MAX_CHATS + 3; i += 1) rememberChat(storage, chat(`c${i}`, i * 100));
    const kept = readHistory(storage);
    expect(kept).toHaveLength(MAX_CHATS);
    expect(kept[0].id).toBe(`c${MAX_CHATS + 2}`);
  });

  it("sheds the oldest to fit a quota rather than losing the current chat", () => {
    rememberChat(storage, chat("old", 1000));
    rememberChat(storage, chat("older", 500));
    // Room for one record only.
    storage.quota = JSON.stringify([chat("new", 2000)]).length;
    const kept = rememberChat(storage, chat("new", 2000));
    expect(kept.map((c) => c.id)).toEqual(["new"]);
    expect(readHistory(storage).map((c) => c.id)).toEqual(["new"]);
  });

  it("survives storage being unavailable entirely", () => {
    storage.quota = 0;
    expect(rememberChat(storage, chat("a", 1))).toEqual([]);
  });
});

describe("forgetChat", () => {
  it("drops one and clears the key when the last one goes", () => {
    rememberChat(storage, chat("a", 1));
    rememberChat(storage, chat("b", 2));
    expect(forgetChat(storage, "a").map((c) => c.id)).toEqual(["b"]);
    expect(forgetChat(storage, "b")).toEqual([]);
    expect(storage.getItem(HISTORY_KEY)).toBeNull();
  });
});

describe("chatTitle", () => {
  it("uses the reader's own first words, collapsed and trimmed", () => {
    expect(chatTitle("  buy   me a tee\nplease ")).toBe("buy me a tee please");
    expect(chatTitle(undefined)).toBe("Untitled conversation");
    expect(chatTitle("")).toBe("Untitled conversation");
    const long = chatTitle("x".repeat(200));
    expect(long).toHaveLength(80);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("relativeTime", () => {
  it("says enough to tell two chats apart", () => {
    const now = 1_000_000_000;
    expect(relativeTime(now - 5_000, now)).toBe("just now");
    expect(relativeTime(now - 12 * 60_000, now)).toBe("12 min ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(relativeTime(now - 26 * 3_600_000, now)).toBe("yesterday");
    expect(relativeTime(now - 3 * 86_400_000, now)).toBe("3 days ago");
  });
});
