import { randomUUID } from "node:crypto";
import { makeDocStore } from "@/lib/doc-store";

// The MERCHANT's store: one JSON document holding its orders, rewritten on every
// change, behind a pluggable
//
// It used to hold the cart and the checkout signing hand-off too. Both moved out:
// the cart is buyer state and now lives in the agent's session (agent/lib/cart.ts,
// #5), and the signing entries carried the buyer's gateway JWT into the merchant's
// hands (src/lib/checkout-signing.ts, #6). What is left is what a merchant
// legitimately owns.
// driver. Local dev uses a file (.data/store.json); when Redis REST
// credentials are present (Vercel KV / Upstash / Redis Cloud on Vercel) the
// same document lives in a single Redis key instead, which is what makes the
// template deployable on Vercel's ephemeral filesystem. Mutations are
// read-modify-write with no locking — fine for a demo, not for production.

export type OrderState =
  | "awaiting_payment" // order created, no payment attached yet
  | "authorizing" // signed payment attached, authorize broadcast in flight
  | "in_escrow" // funds locked on-chain, awaiting fulfilment
  | "capturing" // capture broadcast in flight
  | "settled" // captured — funds with the merchant
  | "voiding" // void broadcast in flight
  | "cancelled" // voided — escrow returned to the buyer
  | "failed"; // an on-chain operation failed (see error)

// The shape of a purchased line. The agent has its own CartLine (agent/lib/cart.ts)
// and that duplication is CORRECT once these are two services: each owns the shape
// it puts on the wire, and neither can reach into the other's types. Here it is
// what an ORDER records; there it is what a buyer is still assembling.
export interface CartLine {
  product_id: string;
  name: string;
  price: string; // human decimal
  qty: number;
}

export interface OrderToken {
  chain_id: number;
  chain_name?: string;
  symbol: string;
  address: string;
  decimals: number;
}

export interface Order {
  id: string;
  state: OrderState;
  lines: CartLine[];
  /** Human decimal total (e.g. "7.15"). */
  total: string;
  /** Total in token base units (set at creation from the chosen token). */
  total_base: string;
  token: OrderToken;
  rail0_id?: string;
  payment_status?: string;
  error?: string;
  /**
   * Set (in the API response only, never persisted) when the gateway refresh
   * failed and this is the last stored snapshot rather than live state.
   */
  stale?: boolean;
  created_at: string;
  updated_at: string;
}

interface StoreData {
  orders: Order[];
}

// Same document, two drivers — the driver logic lives in doc-store.ts so the
// checkout signing stash rides the identical file/Redis switch instead of a
// file-only copy of it.
const store = makeDocStore<StoreData>({
  file: "store.json",
  redisKey: "rail0-starter:store",
  empty: () => ({ orders: [] }),
});

// ── Orders ───────────────────────────────────────────────────────────

export async function createOrder(
  lines: CartLine[],
  total: string,
  totalBase: string,
  token: OrderToken,
): Promise<Order> {
  const data = await store.read();
  const now = new Date().toISOString();
  const order: Order = {
    id: randomUUID().slice(0, 8),
    state: "awaiting_payment",
    lines,
    total,
    total_base: totalBase,
    token,
    created_at: now,
    updated_at: now,
  };
  data.orders.unshift(order);
  await store.write(data);
  return order;
}

export async function getOrder(id: string): Promise<Order | undefined> {
  return (await store.read()).orders.find((o) => o.id === id || o.rail0_id === id);
}

export async function listOrders(): Promise<Order[]> {
  return (await store.read()).orders;
}

export async function updateOrder(
  id: string,
  patch: Partial<Omit<Order, "id" | "created_at">>,
): Promise<Order | undefined> {
  const data = await store.read();
  const order = data.orders.find((o) => o.id === id);
  if (!order) return undefined;
  Object.assign(order, patch, { updated_at: new Date().toISOString() });
  await store.write(data);
  return order;
}
