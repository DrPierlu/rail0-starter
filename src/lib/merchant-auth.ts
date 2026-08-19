import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { ConfigError, env } from "./env";
import { ShopError } from "./shop";

/**
 * The merchant gate: one shared secret in front of everything under /api/shop
 * that MOVES MONEY (capture, void) or names the money (the order list).
 *
 * Nothing checked a credential before. Anyone who could reach the deployment
 * could capture or void any order — real escrowed funds, with the merchant key
 * signing the transaction for them — and GET /api/shop/orders handed out the
 * 8-hex order ids needed to name one. The buyer's own routes are deliberately
 * NOT gated (the browser and the agent are the other deployable, with no
 * merchant credential): the buyer polls its single order by id, and the
 * checkout/signature route carries no merchant token — it is gated on the
 * per-checkout deposit nonce minted at checkout_begin instead.
 *
 * MERCHANT_TOKEN, never NEXT_PUBLIC_*: a NEXT_PUBLIC_ variable is inlined into
 * the client bundle, which would ship the credential to every visitor.
 */

/** Cookie the /merchant dashboard signs in with — httpOnly, so its JS never reads it. */
export const MERCHANT_COOKIE = "rail0_merchant";

/**
 * The configured merchant token, or a ConfigError naming the variable.
 *
 * FAILS CLOSED: with MERCHANT_TOKEN unset the merchant endpoints refuse every
 * request rather than accepting any. It is a ConfigError (not a 401) so the
 * refusal is diagnosable: errorResponse renders the message verbatim, so a
 * developer running locally reads "MERCHANT_TOKEN is not set" in the merchant
 * panel instead of an unexplained "authentication required" they have no
 * credential to satisfy.
 */
export function merchantToken(): string {
  const token = env().MERCHANT_TOKEN;
  if (!token) {
    throw new ConfigError(
      "MERCHANT_TOKEN is not set — the merchant endpoints (order list, capture, void) " +
        "refuse every request until it is. Add it to .env.local (generate one with " +
        "`openssl rand -hex 32`) and sign in on /merchant.",
    );
  }
  return token;
}

/**
 * Constant-time token comparison.
 *
 * timingSafeEqual THROWS on buffers of different lengths, so the length is
 * checked first: unguarded, a token of the wrong length would surface as a 500
 * instead of a refusal. That check leaks the expected length and nothing else,
 * which is the accepted trade — the byte comparison itself stays constant-time,
 * so a wrong token cannot be extended one character at a time.
 */
export function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Authenticate a merchant request, or throw. The token arrives either as
 * `Authorization: Bearer <token>` (scripts, curl) or in the dashboard's
 * httpOnly cookie.
 */
export function requireMerchant(request: NextRequest): void {
  // Read the expected token FIRST: an unconfigured deployment must refuse
  // before any credential can be considered, not fall open.
  const expected = merchantToken();
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const presented = bearer ?? request.cookies.get(MERCHANT_COOKIE)?.value;
  if (!presented || !tokenMatches(presented, expected)) {
    // Same answer whatever the reason — an unknown order, a real order, an
    // expired cookie. A message that told them apart would be the oracle this
    // gate exists to close.
    throw new ShopError(401, "merchant authentication required");
  }
}
