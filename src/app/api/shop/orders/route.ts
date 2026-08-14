import { type NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { requireMerchant } from "@/lib/merchant-auth";
import { readOrders } from "@/lib/shop";

/**
 * The merchant's whole order book — gated. It is the id oracle for the two
 * money-moving routes (capture/void take a payment id and nothing else), and it
 * exposes every buyer's orders to whoever asks. The buyer reads its own order
 * through GET /api/shop/orders/[id], which stays open.
 *
 * Straight from the gateway: `GET /payments` is already scoped to the merchant's own
 * wallet, so there is no list to keep in sync and nothing here can go stale. The
 * `stale` flag and the per-order refresh this route used to do went with the store.
 */
export async function GET(request: NextRequest) {
  try {
    requireMerchant(request);
    return NextResponse.json({ orders: await readOrders() });
  } catch (error) {
    return errorResponse(error);
  }
}
