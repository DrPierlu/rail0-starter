import { describe, expect, it, vi } from "vitest";
import { pickSuggestions, SUGGESTIONS } from "@/lib/suggestions";

describe("pickSuggestions", () => {
  it("draws the requested number, all from the pool", () => {
    const picked = pickSuggestions(4);
    expect(picked).toHaveLength(4);
    expect(picked.every((s) => SUGGESTIONS.includes(s))).toBe(true);
  });

  it("never repeats a prompt within one draw", () => {
    // The row renders each chip keyed by its text, so a duplicate would also be a
    // duplicate React key.
    for (let i = 0; i < 50; i++) {
      const picked = pickSuggestions(4);
      expect(new Set(picked).size).toBe(picked.length);
    }
  });

  it("returns the whole pool when asked for more than it holds", () => {
    const picked = pickSuggestions(SUGGESTIONS.length + 5);
    expect([...picked].sort()).toEqual([...SUGGESTIONS].sort());
  });

  it("varies across calls — the point of the function", () => {
    // 200 draws of 4 from a 16-prompt pool: identical results every time would mean
    // the shuffle never ran. The odds of a false failure are ~(1/43680)^199.
    const draws = new Set(Array.from({ length: 200 }, () => pickSuggestions(4).join("|")));
    expect(draws.size).toBeGreaterThan(1);
  });

  it("covers the whole pool over enough draws — no prompt is unreachable", () => {
    // The bias this pins is the one a `sort(() => Math.random() - 0.5)` shuffle has:
    // it does not fail loudly, it just leaves some prompts far rarer than others.
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) for (const s of pickSuggestions(4)) seen.add(s);
    expect(seen.size).toBe(SUGGESTIONS.length);
  });

  it("takes its randomness from Math.random, one call per drawn item", () => {
    // Pinned so the draw stays inspectable: with Math.random stubbed to 0 every swap
    // is a no-op, which yields the pool's own first n entries.
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      expect(pickSuggestions(3)).toEqual(SUGGESTIONS.slice(0, 3));
      expect(random).toHaveBeenCalledTimes(3);
    } finally {
      random.mockRestore();
    }
  });
});

describe("SUGGESTIONS", () => {
  it("holds more prompts than a row shows, or the draw would be decorative", () => {
    expect(SUGGESTIONS.length).toBeGreaterThan(4);
  });

  it("has no duplicates", () => {
    expect(new Set(SUGGESTIONS).size).toBe(SUGGESTIONS.length);
  });
});
