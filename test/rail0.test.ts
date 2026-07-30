import { describe, expect, it } from "vitest";
import { packSignature } from "@/lib/rail0";

describe("packSignature", () => {
  it("packs { v, r, s } into 65-byte r||s||v hex", () => {
    const r = `0x${"11".repeat(32)}`;
    const s = `0x${"22".repeat(32)}`;
    const packed = packSignature({ v: 27, r, s });
    expect(packed).toBe(`0x${"11".repeat(32)}${"22".repeat(32)}1b`);
    expect(packed).toHaveLength(2 + 65 * 2);
  });

  it("encodes v=28 as 1c", () => {
    const packed = packSignature({
      v: 28,
      r: `0x${"00".repeat(32)}`,
      s: `0x${"00".repeat(32)}`,
    });
    expect(packed.endsWith("1c")).toBe(true);
  });
});
