import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeDocStore } from "@/lib/doc-store";

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
