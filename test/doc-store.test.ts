import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocStoreError, makeDocStore } from "@/lib/doc-store";

// The bug these pin: the eve agent service is a separate process whose cwd is a
// per-build snapshot (.eve/dev-runtime/snapshots/<id>/source). With the path resolved
// from cwd, the browser's signature deposit and the agent's read landed in DIFFERENT
// files — and a fresh empty one after every rebuild — so the checkout hung on "the
// sign-in signature has not arrived yet" with nothing broken anywhere visible.

const store = () =>
  makeDocStore<Record<string, string>>({
    file: "probe.json",
    redisKey: "probe",
    empty: () => ({}),
  });

const originalDataDir = process.env.STARTER_DATA_DIR;
const originalCwd = process.cwd();

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.STARTER_DATA_DIR;
  else process.env.STARTER_DATA_DIR = originalDataDir;
  process.chdir(originalCwd);
});

describe("makeDocStore file driver", () => {
  it("writes into STARTER_DATA_DIR regardless of cwd", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "starter-data-"));
    const elsewhere = mkdtempSync(path.join(tmpdir(), "starter-cwd-"));
    process.env.STARTER_DATA_DIR = dir;
    process.chdir(elsewhere);

    await store().write({ a: "1" });

    // The file follows the env var, not the working directory — which is the whole
    // point: two processes with different cwds must reach the same document.
    expect(JSON.parse(readFileSync(path.join(dir, "probe.json"), "utf8"))).toEqual({ a: "1" });
    expect(await store().read()).toEqual({ a: "1" });
  });

  // Two processes, one directory: what the route writes, the agent reads.
  it("lets a reader in another cwd see what a writer stored", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "starter-data-"));
    const writerCwd = mkdtempSync(path.join(tmpdir(), "starter-writer-"));
    const readerCwd = mkdtempSync(path.join(tmpdir(), "starter-reader-"));
    process.env.STARTER_DATA_DIR = dir;

    process.chdir(writerCwd);
    await store().write({ signature: "0xabc" });

    process.chdir(readerCwd);
    expect(await store().read()).toEqual({ signature: "0xabc" });
  });

  it("falls back to cwd/.data when the env var is unset", async () => {
    delete process.env.STARTER_DATA_DIR;
    const dir = mkdtempSync(path.join(tmpdir(), "starter-cwd-"));
    process.chdir(dir);

    await store().write({ b: "2" });

    expect(JSON.parse(readFileSync(path.join(dir, ".data", "probe.json"), "utf8"))).toEqual({
      b: "2",
    });
  });

  it("reads an empty document when nothing is stored yet", async () => {
    process.env.STARTER_DATA_DIR = mkdtempSync(path.join(tmpdir(), "starter-data-"));
    expect(await store().read()).toEqual({});
  });
});

// ── A document that exists and cannot be read ────────────────────────
//
// The bug these pin: read() caught EVERY error and answered empty(). A truncated
// JSON (or EACCES) therefore looked exactly like a fresh install — and since the
// caller is mutate(), which writes the document straight back, one unreadable read
// replaced every stored order with `{}`. Silent, total data loss. Only ENOENT is
// absence now; anything else fails loudly and leaves the bad copy in place.
describe("makeDocStore file driver on an unreadable document", () => {
  const withCorruptFile = (content: string) => {
    const dir = mkdtempSync(path.join(tmpdir(), "starter-data-"));
    process.env.STARTER_DATA_DIR = dir;
    const file = path.join(dir, "probe.json");
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, content);
    return file;
  };

  it("throws instead of answering an empty document", async () => {
    const file = withCorruptFile('{ "a": "1"');
    await expect(store().read()).rejects.toThrow(DocStoreError);
    // The message has to be actionable: it names the file, since moving it aside is
    // the deliberate way to start over.
    await expect(store().read()).rejects.toThrow(file);
  });

  it("leaves the file untouched, so a mutate cannot erase it", async () => {
    const file = withCorruptFile('{ "keep": "yes"');

    await expect(
      store().mutate((data) => {
        data.added = "no";
      }),
    ).rejects.toThrow(DocStoreError);

    expect(readFileSync(file, "utf8")).toBe('{ "keep": "yes"');
  });

  // An empty file is a half-finished write, not an empty document — the same rule.
  it("treats a truncated (zero-byte) document as unreadable, not empty", async () => {
    withCorruptFile("");
    await expect(store().read()).rejects.toThrow(DocStoreError);
  });
});

// ── The same rule on the Redis driver ────────────────────────────────
//
// It had no catch at all, so one corrupt value 500'd every endpoint until the key
// was deleted by hand. It still refuses — deliberately, and for the file driver's
// reason: swallowed as empty(), the corrupt value would be written back over the
// real document. A key that is not set yet stays the legitimate empty answer.
describe("makeDocStore redis driver", () => {
  const originalUrl = process.env.KV_REST_API_URL;
  const originalToken = process.env.KV_REST_API_TOKEN;

  // One canned GET reply, as Upstash's REST shape: { result: <value|null> }.
  const withStoredValue = (result: unknown) => {
    process.env.KV_REST_API_URL = "https://redis.example";
    process.env.KV_REST_API_TOKEN = "t0ken";
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ result })));
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = originalUrl;
    if (originalToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = originalToken;
  });

  it("reads an empty document when the key is not set yet", async () => {
    withStoredValue(null);
    expect(await store().read()).toEqual({});
  });

  it("throws on a stored value that is not valid JSON, naming the key", async () => {
    withStoredValue('{ "a": "1"');
    await expect(store().read()).rejects.toThrow(DocStoreError);
    await expect(store().read()).rejects.toThrow("probe");
  });

  // An empty string is a value, not an absent key — the zero-byte file of the other
  // driver, and refused for the same reason.
  it("throws on an empty stored value", async () => {
    withStoredValue("");
    await expect(store().read()).rejects.toThrow(DocStoreError);
  });
});

// ── mutate(): serialized read-modify-write ───────────────────────────
//
// The store holds ONE json document, so a read-then-write at the call site
// rewrites everything: two overlapping callers each write what they read, and the
// last one to finish erases the other's change. The real trigger is
// GET /api/shop/orders, which refreshes every order with
// Promise.allSettled(stored.map(refreshOrder)) while the merchant polls every 4s.
// The casualty was the checkout write-ahead — losing rail0_id + "authorizing"
// leaves funds escrowed against an order stuck at awaiting_payment, unrecoverable.
describe("makeDocStore mutate", () => {
  const freshStore = () => {
    const dir = mkdtempSync(path.join(tmpdir(), "starter-data-"));
    process.env.STARTER_DATA_DIR = dir;
    return store();
  };

  it("does not lose a concurrent write the way read-then-write did", async () => {
    const s = freshStore();
    await s.write({});

    // The exact interleaving the order-list refresh produces: N callers started
    // together, each adding its own key.
    await Promise.all(
      ["a", "b", "c", "d", "e"].map((k) =>
        s.mutate((data) => {
          data[k] = k;
        }),
      ),
    );

    expect(await s.read()).toEqual({ a: "a", b: "b", c: "c", d: "d", e: "e" });
  });

  it("shows the lost update that read-then-write still has", async () => {
    const s = freshStore();
    await s.write({});

    // Same five writers, but each reading and writing the whole document itself —
    // the pattern the call sites used. Every one of them read the empty document
    // before any had written, so only the last key survives.
    await Promise.all(
      ["a", "b", "c", "d", "e"].map(async (k) => {
        const data = await s.read();
        data[k] = k;
        await s.write(data);
      }),
    );

    expect(Object.keys(await s.read())).toHaveLength(1);
  });

  it("leaves the document untouched when the callback throws", async () => {
    const s = freshStore();
    await s.write({ keep: "yes" });

    await expect(
      s.mutate(() => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await s.read()).toEqual({ keep: "yes" });
    // The chain must survive a failed mutation — otherwise one error wedges every
    // later write on this store.
    await s.mutate((data) => {
      data.after = "ok";
    });
    expect(await s.read()).toEqual({ keep: "yes", after: "ok" });
  });

  it("skips the write when the callback calls skip(), and still returns its value", async () => {
    const s = freshStore();
    await s.write({ keep: "yes" });

    const result = await s.mutate((data, skip) => {
      data.ignored = "no";
      skip();
      return "reported";
    });

    expect(result).toBe("reported");
    expect(await s.read()).toEqual({ keep: "yes" });
  });
});
