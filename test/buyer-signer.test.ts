import { describe, expect, it } from "vitest";
import { buyerSignerEnabled, pack } from "@/lib/buyer-signer";

describe("buyerSignerEnabled", () => {
  const key = `0x${"a".repeat(64)}`;

  it("is on only in development, with a key", () => {
    expect(buyerSignerEnabled({ nodeEnv: "development", key })).toBe(true);
  });

  it("is off in production even with a key configured", () => {
    // The failure this pins is the serious one: a hosted instance that signs
    // arbitrary payloads with somebody's key for whoever can reach the route.
    expect(buyerSignerEnabled({ nodeEnv: "production", key })).toBe(false);
  });

  it("is off for any environment that is not development", () => {
    // Vercel previews build with NODE_ENV=production, but the gate is an allow-list
    // of one rather than a deny-list, so an environment nobody anticipated is off.
    for (const nodeEnv of ["test", "staging", "preview", undefined]) {
      expect(buyerSignerEnabled({ nodeEnv, key })).toBe(false);
    }
  });

  it("is off in development when no key is configured", () => {
    expect(buyerSignerEnabled({ nodeEnv: "development", key: undefined })).toBe(false);
    expect(buyerSignerEnabled({ nodeEnv: "development", key: "" })).toBe(false);
  });
});

describe("pack", () => {
  it("packs { v, r, s } into 65 bytes of r||s||v", () => {
    const packed = pack({ v: 27, r: `0x${"1".repeat(64)}`, s: `0x${"2".repeat(64)}` });
    expect(packed).toBe(`0x${"1".repeat(64)}${"2".repeat(64)}1b`);
    // 0x + 130 hex characters = 65 bytes, the length the gateway's validator expects.
    expect(packed).toHaveLength(132);
  });

  it("encodes both legal recovery ids as one byte", () => {
    // v is 27 or 28 by type, i.e. 0x1b or 0x1c — always two hex digits, so the
    // signature keeps its length either way and nothing downstream shifts.
    const zeros = `0x${"0".repeat(64)}` as const;
    expect(pack({ v: 27, r: zeros, s: zeros })).toMatch(/1b$/);
    expect(pack({ v: 28, r: zeros, s: zeros })).toMatch(/1c$/);
  });
});
