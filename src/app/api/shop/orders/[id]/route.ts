import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { refreshOrder } from "@/lib/shop";
import { getOrder } from "@/lib/store";

/**
 * One order, refreshed from the gateway on the way out — this is what the buyer's
 * order card polls.
 *
 * A failed refresh falls back to the stored snapshot flagged `stale`, exactly like
 * the merchant's order list does (GET /api/shop/orders): the gateway read is the
 * fragile half, and its failure is not this order's absence. A gateway that 404s
 * the payment (redeployed on a fresh database, a pruned payment, a transient
 * routing 404) used to surface here as a 404 for the ORDER — and the card takes a
 * 404 as terminal: "order not found", polling stopped, for an order that is right
 * there in the store.
 *
 * The one real 404 is an id the store does not know, which is the only case that
 * still answers one.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    try {
      return NextResponse.json({ order: await refreshOrder(id) });
    } catch (error) {
      const stored = await getOrder(id);
      if (!stored) throw error;
      return NextResponse.json({ order: { ...stored, stale: true } });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
