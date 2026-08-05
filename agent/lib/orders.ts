import { defineState } from "eve/context";

/**
 * The orders this conversation placed — buyer state, in the same home and for the
 * same reason as the cart (agent/lib/cart.ts).
 *
 * `my_orders` used to answer from GET /api/shop/orders: the MERCHANT's whole
 * order book. That endpoint is now gated on the merchant token (it is the id
 * oracle for capture/void), and it was the wrong source regardless — it showed
 * every buyer's orders to every session. Remembering the ids the session created
 * lets the tool answer "your orders" from the ungated per-order endpoint.
 */
interface OrdersState {
  /** Order ids in creation order; `myOrderIds` reverses for newest-first. */
  readonly ids: readonly string[];
}

const ordersState = defineState<OrdersState>("rail0-starter.orders", () => ({ ids: [] }));

/** Record an order this session placed. Idempotent — checkout steps are re-run. */
export async function rememberOrder(id: string): Promise<void> {
  await ordersState.update((state) => ({
    ids: state.ids.includes(id) ? state.ids : [...state.ids, id],
  }));
}

/** This session's order ids, newest first. */
export async function myOrderIds(): Promise<string[]> {
  return [...(await ordersState.get()).ids].reverse();
}
