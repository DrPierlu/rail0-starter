import { NextResponse } from "next/server";
import { describe, expect, it } from "vitest";
import { CHECKOUT_COOKIE, setCheckoutSession } from "@/lib/checkout-session";

/**
 * The cookie that replaced the server-side signing stash. What matters about it is not
 * that it exists but HOW it is set: it carries the buyer's gateway JWT, so httpOnly and
 * a narrow path are the properties that make handing it back to the browser safer than
 * keeping it here — and a lifetime that outlives the token would turn a lapsed session
 * into a step 3 that fails at the gateway instead of saying so.
 */
const cookieOf = (expiresAt: string | undefined) => {
  const response = NextResponse.json({ ok: true });
  setCheckoutSession(response, "jwt-token", expiresAt);
  const cookie = response.cookies.get(CHECKOUT_COOKIE);
  if (!cookie) throw new Error("no checkout cookie was set");
  return cookie;
};

describe("setCheckoutSession", () => {
  it("keeps the session out of reach of page JS", () => {
    const cookie = cookieOf(new Date(Date.now() + 3600_000).toISOString());
    expect(cookie.value).toBe("jwt-token");
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("strict");
    // The two checkout routes and nothing else — the merchant's endpoints must never
    // see a buyer's gateway session.
    expect(cookie.path).toBe("/api/checkout");
  });

  it("expires with the gateway session it holds", () => {
    const cookie = cookieOf(new Date(Date.now() + 3600_000).toISOString());
    // Within a second of the hour: the clamp only bites at the extremes.
    expect(cookie.maxAge).toBeGreaterThan(3590);
    expect(cookie.maxAge).toBeLessThanOrEqual(3600);
  });

  it("never outlives a day, however long the gateway says", () => {
    const cookie = cookieOf(new Date(Date.now() + 30 * 24 * 3600_000).toISOString());
    expect(cookie.maxAge).toBe(24 * 3600);
  });

  // An expiry already in the past (a clock skew, a token minted long enough ago) must
  // still leave the checkout in flight able to finish, not a cookie that is dead on
  // arrival — which is a checkout that cannot be submitted at all.
  it("still gives a lapsed or unreadable expiry a usable life", () => {
    expect(cookieOf(new Date(Date.now() - 3600_000).toISOString()).maxAge).toBe(60);
    expect(cookieOf("not a date").maxAge).toBe(15 * 60);
    expect(cookieOf(undefined).maxAge).toBe(15 * 60);
  });
});
