import { describe, expect, it } from "vitest";
import { hasChainLogo } from "@/app/chain-logos";
import { chainMark } from "@/app/ui";

/**
 * The chain's mark in an order row — what lets a two-chain list be sorted by eye before a
 * word of it is read.
 *
 * The seeded chains carry their own logo (chain-logos.tsx, provenance documented there);
 * anything else falls back to a lettered dot, because a chain arrives by a seeds edit in
 * the gateway and must not need a release of this app to render.
 */
describe("chain marks", () => {
  it("has a logo for every chain the gateway seeds", () => {
    for (const chainId of [5042002, 84532, 11155420, 421614, 80002]) {
      expect(hasChainLogo(chainId)).toBe(true);
    }
  });

  it("has no logo for a chain this app has never heard of", () => {
    expect(hasChainLogo(1234567)).toBe(false);
    expect(hasChainLogo(undefined)).toBe(false);
  });

  it("falls back to initials from the words of the name", () => {
    expect(chainMark("Foo Sepolia").initials).toBe("FS");
    expect(chainMark("Localhost").initials).toBe("LO");
    expect(chainMark("chain 1234567").initials).toBe("C1");
    expect(chainMark("Foo Sepolia").className).toContain("neutral");
  });
});
