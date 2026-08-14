import { describe, expect, it } from "vitest";
import { BUYER_COOKIE, hasBuyerSession, readCookie } from "@/lib/buyer-auth";

describe("readCookie", () => {
  it("finds a cookie among others", () => {
    expect(readCookie(`a=1; ${BUYER_COOKIE}=secret; b=2`, BUYER_COOKIE)).toBe("secret");
    expect(readCookie(`${BUYER_COOKIE}=secret`, BUYER_COOKIE)).toBe("secret");
  });

  it("does not match a cookie whose name merely ends the same way", () => {
    // `other_rail0_buyer=x` must not be read as the buyer cookie — a substring match
    // here would accept a cookie any other origin on the domain could set.
    expect(readCookie(`other_${BUYER_COOKIE}=x`, BUYER_COOKIE)).toBeUndefined();
  });

  it("decodes the value and tolerates a malformed header", () => {
    expect(readCookie(`${BUYER_COOKIE}=a%20b`, BUYER_COOKIE)).toBe("a b");
    expect(readCookie(null, BUYER_COOKIE)).toBeUndefined();
    expect(readCookie("", BUYER_COOKIE)).toBeUndefined();
    expect(readCookie("novalue; =x; ;", BUYER_COOKIE)).toBeUndefined();
  });
});

describe("hasBuyerSession", () => {
  it("is false with no cookie", () => {
    expect(hasBuyerSession(null)).toBe(false);
    expect(hasBuyerSession("something=else")).toBe(false);
  });

  it("is false — not an exception — when BUYER_TOKEN is unset", () => {
    // This suite runs with no environment, which is the unconfigured deployment. The
    // authenticator must refuse cleanly: one that throws takes the whole channel down
    // with a 500 instead of answering 401, and a 500 on every request is much harder
    // to recognise as "you forgot a variable".
    expect(hasBuyerSession(`${BUYER_COOKIE}=anything`)).toBe(false);
  });
});
