import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

// A deliberately tiny single-user persistence layer: one JSON file holding the
// cart and the orders, atomically rewritten on every change. This is demo
// plumbing — swap it for a real database in anything beyond a starter.

export type OrderState =
  | "awaiting_payment" // order created, no payment attached yet
  | "authorizing" // signed payment attached, authorize broadcast in flight
  | "in_escrow" // funds locked on-chain, awaiting fulfilment
  | "capturing" // capture broadcast in flight
  | "settled" // captured — funds with the merchant
  | "voiding" // void broadcast in flight
  | "cancelled" // voided — escrow returned to the buyer
  | "failed"; // an on-chain operation failed (see error)

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
  created_at: string;
  updated_at: string;
}

interface StoreData {
  cart: CartLine[];
  orders: Order[];
}

// Resolved lazily so tests can point the store at a temp directory by
// changing the working directory before the first call.
function dataFile(): string {
  return path.join(process.cwd(), ".data", "store.json");
}

function load(): StoreData {
  try {
    return JSON.parse(readFileSync(dataFile(), "utf8")) as StoreData;
  } catch {
    return { cart: [], orders: [] };
  }
}

function save(data: StoreData): void {
  const file = dataFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}

// ── Cart ─────────────────────────────────────────────────────────────

export function getCart(): CartLine[] {
  return load().cart;
}

export function addToCart(line: CartLine): CartLine[] {
  const data = load();
  const existing = data.cart.find((l) => l.product_id === line.product_id);
  if (existing) {
    existing.qty += line.qty;
  } else {
    data.cart.push(line);
  }
  save(data);
  return data.cart;
}

export function removeFromCart(productId: string, qty?: number): CartLine[] {
  const data = load();
  const line = data.cart.find((l) => l.product_id === productId);
  if (line) {
    line.qty -= qty ?? line.qty;
    if (line.qty <= 0) {
      data.cart = data.cart.filter((l) => l.product_id !== productId);
    }
  }
  save(data);
  return data.cart;
}

export function clearCart(): void {
  const data = load();
  data.cart = [];
  save(data);
}

// ── Orders ───────────────────────────────────────────────────────────

export function createOrder(
  lines: CartLine[],
  total: string,
  totalBase: string,
  token: OrderToken,
): Order {
  const data = load();
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
  save(data);
  return order;
}

export function getOrder(id: string): Order | undefined {
  return load().orders.find((o) => o.id === id || o.rail0_id === id);
}

export function listOrders(): Order[] {
  return load().orders;
}

export function updateOrder(
  id: string,
  patch: Partial<Omit<Order, "id" | "created_at">>,
): Order | undefined {
  const data = load();
  const order = data.orders.find((o) => o.id === id);
  if (!order) return undefined;
  Object.assign(order, patch, { updated_at: new Date().toISOString() });
  save(data);
  return order;
}
