import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BUYER_COOKIE, buyerToken, channelOpenLocally, hasBuyerSession } from "@/lib/buyer-auth";
import { errorResponse } from "@/lib/http";
import { tokenMatches } from "@/lib/merchant-auth";
import { ShopError } from "@/lib/shop";

// Signing in to the agent chat: paste BUYER_TOKEN once, get an httpOnly cookie that
// the chat's own same-origin requests to /eve/v1/* then carry by themselves.
//
// Buyer namespace, not /api/shop: this belongs to the buyer side, and the merchant's
// credential is a different secret guarding different endpoints. They are deliberately
// not the same token — the merchant's moves escrowed funds, this one directs an agent.
//
// GET answers whether the caller is signed in, which is what lets the chat page show a
// sign-in form instead of a chat that 401s on the first message with no explanation.

const schema = z.object({ token: z.string().min(1) });

/** Eight hours — a shift, not a permanent grant. Same as the merchant's. */
const MAX_AGE_SECS = 8 * 60 * 60;

export async function GET(request: NextRequest) {
  // `required` is what the page actually needs: on a local dev server the channel is
  // open without a cookie (eve's localDev in the agent process), and asking for a token
  // there would put a form in front of a chat that works — and ask for BUYER_TOKEN,
  // which a local run does not set.
  return NextResponse.json({
    signed_in: hasBuyerSession(request.headers.get("cookie")),
    required: !channelOpenLocally(),
  });
}

export async function POST(request: NextRequest) {
  try {
    // The expected token FIRST: an unconfigured deployment must refuse rather than
    // compare against nothing, and the error names the variable.
    const expected = buyerToken();
    const { token } = schema.parse(await request.json());
    if (!tokenMatches(token, expected)) {
      throw new ShopError(401, "invalid buyer token");
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(BUYER_COOKIE, token, {
      httpOnly: true,
      // strict, so a cross-site request cannot ride this cookie into the agent and
      // spend. The chat's own fetches are same-origin and carry it regardless.
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      // "/" and not "/buyer": the channel lives at /eve/v1/*, so a cookie scoped to the
      // page would never reach the endpoints it is meant to open.
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
  response.cookies.delete(BUYER_COOKIE);
  return response;
}
