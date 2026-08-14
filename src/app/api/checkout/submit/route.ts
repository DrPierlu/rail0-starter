import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { submitPayment } from "@/lib/buyer";
import { checkoutSession, clearCheckoutSession } from "@/lib/checkout-session";
import { errorResponse } from "@/lib/http";
import { ShopError } from "@/lib/shop";
import { shopBase } from "@/lib/shop-base";

/**
 * Checkout step 3, buyer side: the EIP-3009 signature for the payment created in step
 * 2, signed with the same wallet.
 *
 * The buyer's gateway session comes from the httpOnly cookie step 2 set, so the
 * request body carries only public artifacts — a payment id and a signature that ends
 * up on-chain anyway. A missing cookie is a lapsed or restarted checkout, and says so:
 * signing again with no session would fail deep inside the gateway with a 401 that
 * reads as a problem with the signature.
 *
 * The cookie is dropped on the way out. Its whole purpose was this one hop.
 */
const schema = z.object({
  rail0_id: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]{100,}$/, {
    message: "signature must be a 0x hex signature",
  }),
});

export async function POST(request: NextRequest) {
  try {
    const authToken = checkoutSession(request);
    if (!authToken) {
      throw new ShopError(401, "the buyer session has expired — start the checkout again");
    }
    const body = schema.parse(await request.json());
    const { order } = await submitPayment({
      base: shopBase(),
      rail0Id: body.rail0_id,
      signature: body.signature,
      authToken,
    });

    const response = NextResponse.json({ order }, { status: 202 });
    clearCheckoutSession(response);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
