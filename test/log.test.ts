import { afterEach, describe, expect, it, vi } from "vitest";
import { logEvent, short, startOp } from "@/lib/log";

/**
 * The log's one hard rule: a secret must not be able to reach it.
 *
 * Callers pass fields by name, so a leak here is a future edit adding the wrong one —
 * which is exactly the edit no reviewer catches. The name filter and the length cap are
 * the backstop, and this pins both.
 */

function captured(run: () => void): string[] {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  run();
  const lines = spy.mock.calls.map((call) => String(call[0]));
  spy.mockRestore();
  return lines;
}

afterEach(() => vi.restoreAllMocks());

describe("log", () => {
  it("drops secret-looking fields whatever the caller passes", () => {
    const [line] = captured(() =>
      logEvent("authorize", {
        payment: "0xabc",
        signed_transaction: "0xdeadbeef",
        private_key: "0x1234",
        signature: "0xsig",
      }),
    );
    expect(line).toContain("payment=0xabc");
    expect(line).not.toContain("deadbeef");
    expect(line).not.toContain("0x1234");
    expect(line).not.toContain("0xsig");
  });

  it("truncates long values, so a blob cannot become the log", () => {
    const [line] = captured(() => logEvent("op", { note: "a".repeat(500) }));
    expect(line.length).toBeLessThan(140);
    expect(line).toContain("…");
  });

  it("writes one line per operation, with its outcome and duration", () => {
    const lines = captured(() => {
      const op = startOp("capture", { payment: short(`0x${"1".repeat(64)}`) });
      op.ok({ state: "capturing" });
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^rail0 capture ok payment=0x11111111…111111 state=capturing \d+ms$/);
  });

  it("logs an error's message, never the error object", () => {
    const [line] = captured(() => startOp("void").fail(new Error("gateway said no")));
    expect(line).toContain("FAILED");
    expect(line).toContain("error=gateway said no");
  });

  it("shortens ids to comparable halves and leaves short values alone", () => {
    expect(short("0x1234")).toBe("0x1234");
    expect(short(`0x${"ab".repeat(32)}`)).toBe("0xabababab…ababab");
  });
});
