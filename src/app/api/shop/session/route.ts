import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { MERCHANT_COOKIE, merchantToken, tokenMatches } from "@/lib/merchant-auth";
import { ShopError } from "@/lib/shop";

// The merchant dashboard's sign-in: the operator pastes MERCHANT_TOKEN once and
// gets an httpOnly cookie that the page's existing same-origin fetches carry by
// themselves.
//
// The alternative — a server component reading MERCHANT_TOKEN and handing it to
// the client to send back — was rejected: /merchant is not itself protected, so
// that embeds the credential in a page ANY visitor can load, which is the hole
// this closes rather than a fix for it.
//
// Merchant namespace (/api/shop), like every other merchant route; the buyer's
// signature hand-off lives under /api/checkout for the same reason.

const schema = z.object({ token: z.string().min(1) });

/** Eight hours — a shift, not a permanent grant. */
const MAX_AGE_SECS = 8 * 60 * 60;

export async function POST(request: NextRequest) {
  try {
    const expected = merchantToken();
    const { token } = schema.parse(await request.json());
    if (!tokenMatches(token, expected)) {
      throw new ShopError(401, "invalid merchant token");
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(MERCHANT_COOKIE, token, {
      httpOnly: true,
      // sameSite strict, so a cross-site POST cannot ride the cookie into
      // capture/void. Same-origin fetches from /merchant still carry it however
      // the operator navigated there, because the page itself needs no cookie
      // to render.
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: MAX_AGE_SECS,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

/** Sign out. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(MERCHANT_COOKIE);
  return response;
}
