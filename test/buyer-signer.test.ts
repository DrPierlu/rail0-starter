import { describe, expect, it } from "vitest";
import { agentWalletConfigured, withinAutonomousLimit } from "@/lib/buyer-signer";

// The signature packing itself is packSignature (lib/rail0), covered by
// test/rail0.test.ts — signAsAgent calls it rather than carrying its own copy.

describe("agentWalletConfigured", () => {
  it("is the presence of a key, and nothing else", () => {
    expect(agentWalletConfigured(`0x${"a".repeat(64)}`)).toBe(true);
    expect(agentWalletConfigured(undefined)).toBe(false);
    expect(agentWalletConfigured("")).toBe(false);
  });
});

describe("withinAutonomousLimit", () => {
  it("allows a total at or under the ceiling", () => {
    expect(withinAutonomousLimit("9.90", 25)).toBe(true);
    expect(withinAutonomousLimit("25.00", 25)).toBe(true);
  });

  it("sends a total over the ceiling to a human", () => {
    expect(withinAutonomousLimit("25.01", 25)).toBe(false);
    expect(withinAutonomousLimit("1000", 25)).toBe(false);
  });

  it("treats a ceiling of 0 as no ceiling", () => {
    expect(withinAutonomousLimit("100000", 0)).toBe(true);
  });

  it("escalates a total it cannot read, rather than passing it", () => {
    // The dangerous default: Number("") is 0 and Number("abc") is NaN, and a naive
    // `<= limit` lets the first through as free and — with NaN — silently compares
    // false either way. An amount nobody can read is exactly what a person should see.
    for (const bad of ["", "abc", "NaN", "1,00"]) {
      expect(withinAutonomousLimit(bad, 25)).toBe(false);
    }
  });

  it("compares numerically, so trailing zeros do not matter", () => {
    expect(withinAutonomousLimit("9.9", 9.9)).toBe(true);
    expect(withinAutonomousLimit("9.90", 9.9)).toBe(true);
  });
});
