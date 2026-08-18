import { afterEach, describe, expect, it } from "vitest";
import { BUYER_COOKIE, channelOpenLocally, hasBuyerSession, readCookie } from "@/lib/buyer-auth";

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

/**
 * Where the chat asks for BUYER_TOKEN, and where it must not.
 *
 * The regression: this tested EVE_DEV=1, which eve sets in the process running the AGENT
 * — never in the Next process that answers /api/buyer/session. So a local `bin/dev` run
 * showed the deployed sign-in form, asking for a variable bin/dev does not set, in front
 * of a channel that was already open. What Next CAN see is NODE_ENV, and withEve starts
 * the open `eve dev` sibling on exactly that condition.
 */
describe("channelOpenLocally", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  function envis(values: Record<string, string | undefined>) {
    for (const key of ["NODE_ENV", "VERCEL", "VERCEL_ENV", "EVE_DEV", "EVE_BASE_URL"]) {
      delete process.env[key];
    }
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) process.env[key] = value;
    }
  }

  it("opens on a local dev server, which is where EVE_DEV was never visible", () => {
    envis({ NODE_ENV: "development" });
    expect(channelOpenLocally()).toBe(true);
  });

  it("opens under `vercel dev`, which is a dev server that happens to set VERCEL", () => {
    envis({ NODE_ENV: "development", VERCEL: "1", VERCEL_ENV: "development" });
    expect(channelOpenLocally()).toBe(true);
  });

  it("asks on every real Vercel environment", () => {
    for (const vercelEnv of ["production", "preview"]) {
      envis({ NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: vercelEnv });
      expect(channelOpenLocally()).toBe(false);
      // Even if the build somehow claims development: a deployed URL always asks.
      envis({ NODE_ENV: "development", VERCEL: "1", VERCEL_ENV: vercelEnv });
      expect(channelOpenLocally()).toBe(false);
    }
  });

  it("asks on a production build served anywhere", () => {
    envis({ NODE_ENV: "production" });
    expect(channelOpenLocally()).toBe(false);
  });

  it("asks when the agent is an eve server this app did not start", () => {
    envis({ NODE_ENV: "development", EVE_BASE_URL: "https://agent.example.com" });
    expect(channelOpenLocally()).toBe(false);
  });
});
