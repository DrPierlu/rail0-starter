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
 * MIRRORS eve's own `localDev()`, deliberately and with the same rule: `eve dev`
 * (EVE_DEV=1) or `vercel dev` (VERCEL=1 with VERCEL_ENV=development). It is duplicated
 * because the CHANNEL decides who gets in while the PAGE decides whether to ask for a
 * token, and the page cannot call an AuthFn — it has no Request. If eve's rule ever
 * changes, this is the line that has to follow, and the failure is loud: a sign-in form
 * in front of a chat that would have worked.
 *
 * A property of the deployment, never of the request — no inbound header can flip it.
 */
export function channelOpenLocally(): boolean {
  return (
    process.env.EVE_DEV === "1" ||
    (process.env.VERCEL === "1" && process.env.VERCEL_ENV === "development")
  );
}
