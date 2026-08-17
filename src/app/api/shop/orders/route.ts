import { type NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { requireMerchant } from "@/lib/merchant-auth";
import { readOrders } from "@/lib/shop";

/** What the dashboard asks for first (keep it in step with PAGE there), and its ceiling. */
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 100;

/**
 * The merchant's whole order book — gated. It is the id oracle for the two
 * money-moving routes (capture/void take a payment id and nothing else), and it
 * exposes every buyer's orders to whoever asks. The buyer reads its own order
 * through GET /api/shop/orders/[id], which stays open.
 *
 * Straight from the gateway: `GET /payments` is already scoped to the merchant's own
 * wallet, so there is no list to keep in sync and nothing here can go stale. The
 * `stale` flag and the per-order refresh this route used to do went with the store.
 *
 * Paged, because this is polled every five seconds and a shop with a thousand orders
 * would fetch all of them each tick to show the ten anyone is looking at. `limit` is
 * clamped rather than trusted: it is the size of a gateway page and reaches the
 * network.
 */
export async function GET(request: NextRequest) {
  try {
    requireMerchant(request);
    const asked = Number(request.nextUrl.searchParams.get("limit"));
    const limit = Number.isFinite(asked)
      ? Math.min(Math.max(Math.trunc(asked), 1), MAX_LIMIT)
      : DEFAULT_LIMIT;
    const { orders, total, unresolved } = await readOrders(limit);
    // `unresolved` travels with the page: a row whose token the gateway catalog does not
    // know cannot be rendered, and the dashboard says so rather than showing a list that
    // looks complete (see readOrders).
    return NextResponse.json({ orders, total, unresolved });
  } catch (error) {
    return errorResponse(error);
  }
}
