import { describe, expect, it } from "vitest";
import { agentWalletConfigured } from "@/lib/buyer-signer";

// The signature packing itself is packSignature (lib/rail0), covered by
// test/rail0.test.ts — signAsAgent calls it rather than carrying its own copy. The
// spending ceilings moved to lib/agent-budget, and so did their tests.

describe("agentWalletConfigured", () => {
  it("is the presence of a key, and nothing else", () => {
    // No environment check: configuring the key IS the opt-in to autonomous spending,
    // and gating it on NODE_ENV would only mean the switch does nothing where it is
    // meant to be used.
    expect(agentWalletConfigured(`0x${"a".repeat(64)}`)).toBe(true);
    expect(agentWalletConfigured(undefined)).toBe(false);
    expect(agentWalletConfigured("")).toBe(false);
  });
});
