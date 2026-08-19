import { describe, expect, it } from "vitest";
import { ConfigError } from "@/lib/env";
import { merchantToken, tokenMatches } from "@/lib/merchant-auth";

// env() parses lazily and caches, so the values this file needs are set before any
// test body runs. MERCHANT_TOKEN is deliberately left UNSET: the fail-closed
// assertion below is the one that matters most, and the cache means a file cannot
// see it both ways.
process.env.MERCHANT_PRIVATE_KEY = `0x${"11".repeat(32)}`;
delete process.env.MERCHANT_TOKEN;

describe("tokenMatches", () => {
  it("accepts the exact token", () => {
    expect(tokenMatches("s3cret", "s3cret")).toBe(true);
  });

  it("rejects a different token of the same length", () => {
    expect(tokenMatches("s3crXt", "s3cret")).toBe(false);
  });

  // The bug this pins: timingSafeEqual THROWS on buffers of different lengths, so
  // an unguarded compare turned a wrong-length token into a 500 (and a stack trace)
  // instead of a refusal.
  it("rejects a shorter or longer token without throwing", () => {
    expect(tokenMatches("", "s3cret")).toBe(false);
    expect(tokenMatches("s3cre", "s3cret")).toBe(false);
    expect(tokenMatches("s3cret-and-more", "s3cret")).toBe(false);
  });
});

describe("merchantToken", () => {
  it("fails closed when MERCHANT_TOKEN is unset, naming the variable", () => {
    expect(() => merchantToken()).toThrow(ConfigError);
    expect(() => merchantToken()).toThrow(/MERCHANT_TOKEN/);
  });
});
