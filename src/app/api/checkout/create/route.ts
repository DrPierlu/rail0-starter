import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createPayment } from "@/lib/buyer";
import { setCheckoutSession } from "@/lib/checkout-session";
import { errorResponse } from "@/lib/http";
import { shopBase } from "@/lib/shop-base";

/**
 * Checkout step 2, buyer side: the SIWE signature the wallet just produced, the items
 * it is for, and nothing else.
 *
 * ONE request, because the two halves are inseparable — the gateway requires the payer
 * to be the caller, so the session this signature buys is the only thing that can
 * create this payment. Splitting them is what forced a server-side stash to hold the
 * signature in between, and that stash held the buyer's gateway JWT.
 *
 * The card's `checkout_id` rides along as the Idempotency-Key: this endpoint is the one
 * that MINTS a payment, so it is the one that must not do it twice for the same card.
 *
 * The session goes back out as an httpOnly cookie (lib/checkout-session): the browser
 * keeps its own credential, this server keeps nothing, and step 3 gets it back on the
 * next request without the page ever being able to read it.
 *
 * Open, like the quote. Everything it does is done AS the caller — they signed, they
 * pay, the merchant is the payee either way — so there is nothing here to gate.
 */
const schema = z.object({
  // The card's checkout id, used as the gateway's Idempotency-Key. Optional so an older
  // card (or a caller that has none) still works — it just loses the replay protection.
  checkout_id: z.string().min(1).max(64).optional(),
  items: z.array(z.object({ product_id: z.string(), qty: z.number().int().positive() })).min(1),
  chain_id: z.number().int(),
  token_address: z.string(),
  siwe_message: z.string().min(1),
  siwe_signature: z.string().regex(/^0x[0-9a-fA-F]{100,}$/, {
    message: "siwe_signature must be a 0x hex signature",
  }),
});

export async function POST(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const created = await createPayment({
      base: shopBase(),
      items: body.items,
      chainId: body.chain_id,
      tokenAddress: body.token_address,
      siweMessage: body.siwe_message,
      siweSignature: body.siwe_signature,
      idempotencyKey: body.checkout_id,
    });

    // The token is NOT in the body: it is the one thing here that can act as the buyer,
    // and page JS has no use for it — the card sends the next request, the cookie rides
    // along by itself.
    const response = NextResponse.json({
      rail0_id: created.rail0_id,
      signing_payload: created.signing_payload,
      total: created.quote.total,
      token: created.quote.token,
      lines: created.quote.lines,
    });
    setCheckoutSession(response, created.auth_token, created.expires_at);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
