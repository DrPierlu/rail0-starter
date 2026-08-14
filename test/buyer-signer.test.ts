import { describe, expect, it } from "vitest";
import { buyerSignerEnabled } from "@/lib/buyer-signer";

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

// The signature packing itself is packSignature (lib/rail0), covered by
// test/rail0.test.ts — signAsBuyer calls it rather than carrying its own copy.
