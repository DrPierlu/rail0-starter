import type { NextRequest, NextResponse } from "next/server";

/**
 * The buyer's gateway session, for the one hop between checkout step 2 and step 3.
 *
 * This is what replaced the signing stash, and the difference is who holds the
 * credential. The stash kept the buyer's gateway JWT on the SERVER, in a document any
 * process with the store could read — a token that for 24 hours can create payments,
 * sign them, and read that buyer's whole payment history. Here the same token goes back
 * to the browser that earned it, in an httpOnly cookie: the page's own JS cannot read
 * it, it rides only the buyer's own requests, and this server keeps nothing.
 *
 * Scoped to /api/checkout, which is precisely the two routes that need it — the
 * merchant's endpoints must never see it, and a "/" cookie would attach it to every
 * request in the app.
 *
 * The autonomous path uses none of this: the agent holds its session in a local
 * variable for the length of one function call (see checkoutAsAgent).
 */

export const CHECKOUT_COOKIE = "rail0_checkout";

const COOKIE_PATH = "/api/checkout";

/** Never longer than the gateway session itself, and never longer than a day. */
const MAX_AGE_CAP_SECS = 24 * 60 * 60;

/**
 * Park the buyer's session on the response.
 *
 * The cookie expires with the token: a cookie that outlives its JWT is a step 3 that
 * fails at the gateway with a 401 instead of telling the buyer their checkout lapsed.
 * A malformed or past expiry falls back to a short life rather than no cookie at all —
 * the checkout in flight has to be able to finish.
 */
export function setCheckoutSession(
  response: NextResponse,
  token: string,
  expiresAt: string | undefined,
): void {
  const remaining = expiresAt
    ? Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)
    : Number.NaN;
  const maxAge = Number.isFinite(remaining)
    ? Math.min(Math.max(remaining, 60), MAX_AGE_CAP_SECS)
    : 15 * 60;

  response.cookies.set(CHECKOUT_COOKIE, token, {
    httpOnly: true,
    // strict: nothing cross-site should ever be able to ride a buyer's session into
    // the checkout. The card's own fetches are same-origin.
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: COOKIE_PATH,
    maxAge,
  });
}

export function checkoutSession(request: NextRequest): string | undefined {
  return request.cookies.get(CHECKOUT_COOKIE)?.value;
}

/** Drop it the moment the checkout is done — the token has nothing left to do. */
export function clearCheckoutSession(response: NextResponse): void {
  response.cookies.set(CHECKOUT_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: COOKIE_PATH,
    maxAge: 0,
  });
}
