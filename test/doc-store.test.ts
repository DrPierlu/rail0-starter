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
