import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { readOrder } from "@/lib/shop";

/**
 * One order — this is what the buyer's checkout panel polls.
 *
 * The id IS the rail0 payment id: there is no local order id any more, because there is
 * no local order. Which also settles what a 404 means here — the gateway has no such
 * payment — where before it could mean either that or "the gateway read failed", and
 * the card treated both as terminal.
 *
 * Open, like the quote: a payment id is a 32-byte identifier the buyer holds, and the
 * projection carries nothing operational (see order-view).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const order = await readOrder(id);
    if (!order) return NextResponse.json({ error: "order not found" }, { status: 404 });
    return NextResponse.json({ order });
  } catch (error) {
    return errorResponse(error);
  }
}
