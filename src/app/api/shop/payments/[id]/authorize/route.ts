import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { authorizePayment } from "@/lib/shop";

/**
 * The merchant escrows a signed payment — checkout step 3, seller half.
 *
 * The body is empty on purpose: the id in the path is the only input, and everything
 * that matters about the payment (payee, amount, mode, what it claims to buy) is read
 * from the gateway and priced against the catalog. A request cannot assert anything
 * here, which is what lets this stay open — the payer has already signed, and the
 * merchant is only agreeing to take money it is owed.
 *
 * It replaced POST /api/shop/orders/:id/payment, whose id was a local order and whose
 * body carried the rail0 id. There is one identity now.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ order: await authorizePayment(id) }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
