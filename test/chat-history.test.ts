import { beforeEach, describe, expect, it } from "vitest";
import {
  type ChatRecord,
  chatTitle,
  clearCurrentChatId,
  CURRENT_KEY,
  forgetChat,
  HISTORY_KEY,
  MAX_CHATS,
  readCurrentChatId,
  readHistory,
  relativeTime,
  rememberChat,
  setCurrentChatId,
  type StorageLike,
} from "@/lib/chat-history";

/**
 * The buyer's chat history.
 *
 * What this pins is the pair of requirements that used to be mutually exclusive: the chat
 * opens clean (nothing here resumes anything on its own — that is the page's mount) and
 * the conversations survive the tab that held them.
 *
 * The current-chat pointer is the third: which conversation ONE VISIT is in, so walking
 * to /merchant and back does not read as having lost it.
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

describe("the current-chat pointer", () => {
  it("is absent until something points it somewhere — a fresh tab opens clean", () => {
    expect(readCurrentChatId(storage)).toBeUndefined();
  });

  it("round-trips, and is cleared outright rather than blanked", () => {
    setCurrentChatId(storage, "session-1");
    expect(readCurrentChatId(storage)).toBe("session-1");
    setCurrentChatId(storage, "session-2");
    expect(readCurrentChatId(storage)).toBe("session-2");
    clearCurrentChatId(storage);
    expect(readCurrentChatId(storage)).toBeUndefined();
    expect(storage.getItem(CURRENT_KEY)).toBeNull();
  });

  it("lives apart from the list, so clearing one leaves the other", () => {
    rememberChat(storage, chat("session-1", 1));
    setCurrentChatId(storage, "session-1");
    clearCurrentChatId(storage);
    // The conversation is still THERE — the visit just no longer opens on it.
    expect(readHistory(storage).map((c) => c.id)).toEqual(["session-1"]);
  });

  it("survives storage that throws, because a resume hint is never worth a broken page", () => {
    const dead: StorageLike = {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("SecurityError");
      },
      removeItem() {
        throw new Error("SecurityError");
      },
    };
    expect(() => setCurrentChatId(dead, "session-1")).not.toThrow();
    expect(readCurrentChatId(dead)).toBeUndefined();
    expect(() => clearCurrentChatId(dead)).not.toThrow();
  });

  it("can point at a chat the list no longer holds — the page opens clean on it", () => {
    // MAX_CHATS eviction, or a delete in another tab. The pointer is a hint, not a
    // guarantee, and the mount resolves it against the list rather than trusting it.
    setCurrentChatId(storage, "evicted");
    for (let i = 0; i <= MAX_CHATS; i++) rememberChat(storage, chat(`chat-${i}`, i + 1));
    const chats = readHistory(storage);
    expect(chats.find((c) => c.id === readCurrentChatId(storage))).toBeUndefined();
  });
});
