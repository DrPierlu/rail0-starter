import { ConfigError, env } from "./env";
import { tokenMatches } from "./merchant-auth";

/**
 * Who may talk to the AGENT.
 *
 * The chat's endpoints (`/eve/v1/*`, mounted by withEve) used to accept everyone, and
 * that was defensible while the buyer paid from their own wallet: whoever arrived spent
 * their own money. It stopped being defensible when the deployment got a wallet of its
 * own — talking to the agent then IS spending, and the spending approval is asked and
 * answered over this very channel, so an open channel makes that approval a formality
 * rather than a gate.
 *
 * One shared secret, because this is one operator's own deployment: there are no
 * customers to tell apart, and accounts would be machinery with nothing to hold. The
 * shape mirrors the merchant gate exactly — same constant-time compare, same httpOnly
 * cookie — so there is one idea to understand here, not two.
 */

/** The cookie the buyer chat signs in with — httpOnly, so page JS never reads it. */
export const BUYER_COOKIE = "rail0_buyer";

/**
 * The configured buyer token, or a ConfigError naming the variable.
 *
 * FAILS CLOSED, like the merchant gate: with BUYER_TOKEN unset a deployed chat refuses
 * everyone rather than admitting everyone. That is the safe direction, and it is the
 * one worth being loud about — a deploy that forgets this variable gets a chat that
 * says 401, not a chat that quietly serves the world.
 */
export function buyerToken(): string {
  const token = env().BUYER_TOKEN;
  if (!token) {
    throw new ConfigError(
      "BUYER_TOKEN is not set — the agent chat refuses every request until it is. " +
        "Generate one with `openssl rand -hex 32`.",
    );
  }
  return token;
}

/**
 * Whether this request carries a valid buyer cookie.
 *
 * Reads the raw Cookie header rather than Next's helper: the channel's AuthFn is handed
 * a plain `Request`, not a NextRequest, so there is no cookie jar on it.
 *
 * Never throws. An unconfigured deployment is "not signed in" here — the caller decides
 * whether that is a 401 or a message, and an authenticator that raises would take the
 * whole channel down with a 500 instead of refusing cleanly.
 */
export function hasBuyerSession(cookieHeader: string | null): boolean {
  const presented = readCookie(cookieHeader, BUYER_COOKIE);
  if (!presented) return false;
  try {
    return tokenMatches(presented, buyerToken());
  } catch {
    return false;
  }
}

/** One cookie out of a Cookie header, undecoded values tolerated. */
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * Whether the channel is open without a cookie because this is a local dev server.
 *
 * The CHANNEL decides who gets in; this decides whether the PAGE asks for a token. They
 * have to agree, and the page cannot call an AuthFn — it has no Request — so the rule is
 * restated here. Getting it wrong in this direction is loud and useless: a sign-in form
 * in front of a chat that would have worked, asking for a variable `bin/dev` does not
 * even set.
 *
 * Which is what it did. It used to test EVE_DEV=1, eve's own flag — and eve sets that in
 * the process running the AGENT, which `withEve` spawns as a sibling dev server. This
 * code runs in the NEXT process, which never has it, so a local run showed the deployed
 * gate. The condition that IS true here is the one withEve itself branches on: it starts
 * that `eve dev` sibling (EVE_DEV=1, channel open) only when NODE_ENV is `development`,
 * so in this process `development` means exactly "the agent behind us is a dev server".
 * `vercel dev` is covered by the same test — it runs `next dev`.
 *
 * The two guards are cases where `development` is true and the channel still is not ours
 * to assume open: a real Vercel environment, and an `EVE_BASE_URL` pointing at an eve
 * server this app did not start.
 *
 * A property of the deployment, never of the request — no inbound header can flip it.
 */
export function channelOpenLocally(): boolean {
  if (process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "development") return false;
  if (process.env.EVE_BASE_URL) return false;
  return process.env.NODE_ENV === "development";
}
