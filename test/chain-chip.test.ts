import { describe, expect, it } from "vitest";
import { chainMark } from "@/app/ui";

/**
 * The chain's mark in an order row — the colour that lets a two-chain list be sorted by
 * eye before a word of it is read.
 *
 * Letters rather than the chains' own logos, on purpose (see CHAIN_MARKS): a template
 * that ships five companies' artwork ships five trademark questions with it, and the
 * colour is what the eye is actually using.
 */
describe("chainMark", () => {
  it("gives each seeded chain its own colour", () => {
    const arc = chainMark(5042002, "Arc Testnet");
    const base = chainMark(84532, "Base Sepolia");
    expect(arc.initials).toBe("AR");
    expect(base.initials).toBe("BA");
    expect(arc.className).not.toBe(base.className);
  });

  it("keys on the chain id, not the label the gateway happens to send", () => {
    // The name is a seeds value and can be edited there; the id cannot.
    expect(chainMark(84532, "Base (staging)")).toEqual(chainMark(84532, "Base Sepolia"));
  });

  it("still draws a mark for a chain added to the gateway but not to this app", () => {
    const unknown = chainMark(1234567, "Foo Sepolia");
    expect(unknown.initials).toBe("FS");
    expect(unknown.className).toContain("neutral");
  });

  it("copes with a one-word name and with no chain id at all", () => {
    expect(chainMark(undefined, "chain 1234567").initials).toBe("C1");
    expect(chainMark(7777, "Localhost").initials).toBe("LO");
  });
});
