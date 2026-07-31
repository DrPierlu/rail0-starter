import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

// A deliberately tiny single-user persistence layer: one JSON document holding
// the cart and the orders, rewritten on every change, behind a pluggable
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

/**
 * Browser-produced artifacts of an in-flight keyless checkout, keyed by order.
 * The buyer's key never reaches the server, so its SIGNATURES (public data —
 * they end up on-chain / at the gateway anyway) are handed over out-of-band
 * through the storefront and parked here between the checkout steps, instead
 * of round-tripping through the model's context where a mangled hex digit
 * would burn the payment.
 */
export interface SigningEntry {
  /** Checksummed buyer address, fixed at checkout_begin. */
  address: string;
  siwe_message: string;
  siwe_signature?: string;
  /** Buyer-session JWT, cached between the create and submit steps. */
  auth_token?: string;
  rail0_id?: string;
  eip3009_signature?: string;
}

interface StoreData {
  cart: CartLine[];
  orders: Order[];
  signing?: Record<string, SigningEntry>;
}

const EMPTY: StoreData = { cart: [], orders: [] };

interface StoreDriver {
  read(): Promise<StoreData>;
  write(data: StoreData): Promise<void>;
}

// ── File driver (local dev) ──────────────────────────────────────────

// Resolved lazily so tests can point the store at a temp directory by
// changing the working directory before the first call.
function dataFile(): string {
  return path.join(process.cwd(), ".data", "store.json");
}

const fileDriver: StoreDriver = {
  async read() {
    try {
      return JSON.parse(readFileSync(dataFile(), "utf8")) as StoreData;
    } catch {
      return structuredClone(EMPTY);
    }
  },
  async write(data) {
    const file = dataFile();
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, file);
  },
};

// ── Redis REST driver (Vercel KV / Upstash) ──────────────────────────

const REDIS_KEY = "rail0-starter:store";

function redisCredentials(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

// Single-command Upstash REST call: POST the command as a JSON array.
async function redis(command: unknown[]): Promise<unknown> {
  const { url, token } = redisCredentials() as { url: string; token: string };
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = (await response.json()) as { result?: unknown; error?: string };
  if (!response.ok || body.error) {
    throw new Error(`store redis error: ${body.error ?? response.status}`);
  }
  return body.result;
}

const redisDriver: StoreDriver = {
  async read() {
    const raw = (await redis(["GET", REDIS_KEY])) as string | null;
    return raw ? (JSON.parse(raw) as StoreData) : structuredClone(EMPTY);
  },
  async write(data) {
    await redis(["SET", REDIS_KEY, JSON.stringify(data)]);
  },
};

function driver(): StoreDriver {
  return redisCredentials() ? redisDriver : fileDriver;
}

// ── Cart ─────────────────────────────────────────────────────────────

export async function getCart(): Promise<CartLine[]> {
  return (await driver().read()).cart;
}

export async function addToCart(line: CartLine): Promise<CartLine[]> {
  const store = driver();
  const data = await store.read();
  const existing = data.cart.find((l) => l.product_id === line.product_id);
  if (existing) {
    existing.qty += line.qty;
  } else {
    data.cart.push(line);
  }
  await store.write(data);
  return data.cart;
}

export async function removeFromCart(productId: string, qty?: number): Promise<CartLine[]> {
  const store = driver();
  const data = await store.read();
  const line = data.cart.find((l) => l.product_id === productId);
  if (line) {
    line.qty -= qty ?? line.qty;
    if (line.qty <= 0) {
      data.cart = data.cart.filter((l) => l.product_id !== productId);
    }
  }
  await store.write(data);
  return data.cart;
}

export async function clearCart(): Promise<void> {
  const store = driver();
  const data = await store.read();
  data.cart = [];
  await store.write(data);
}

// ── Orders ───────────────────────────────────────────────────────────

export async function createOrder(
  lines: CartLine[],
  total: string,
  totalBase: string,
  token: OrderToken,
): Promise<Order> {
  const store = driver();
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
  return (await driver().read()).orders.find((o) => o.id === id || o.rail0_id === id);
}

export async function listOrders(): Promise<Order[]> {
  return (await driver().read()).orders;
}

export async function updateOrder(
  id: string,
  patch: Partial<Omit<Order, "id" | "created_at">>,
): Promise<Order | undefined> {
  const store = driver();
  const data = await store.read();
  const order = data.orders.find((o) => o.id === id);
  if (!order) return undefined;
  Object.assign(order, patch, { updated_at: new Date().toISOString() });
  await store.write(data);
  return order;
}

// ── Checkout signing hand-off ────────────────────────────────────────

export async function getSigning(orderId: string): Promise<SigningEntry | undefined> {
  return (await driver().read()).signing?.[orderId];
}

/** Create or merge the signing entry for an order. */
export async function putSigning(
  orderId: string,
  patch: Partial<SigningEntry> & Pick<SigningEntry, "address" | "siwe_message">,
): Promise<SigningEntry>;
export async function putSigning(
  orderId: string,
  patch: Partial<SigningEntry>,
): Promise<SigningEntry | undefined>;
export async function putSigning(
  orderId: string,
  patch: Partial<SigningEntry>,
): Promise<SigningEntry | undefined> {
  const store = driver();
  const data = await store.read();
  data.signing ??= {};
  const existing = data.signing[orderId];
  if (!existing && (!patch.address || !patch.siwe_message)) return undefined;
  const entry = { ...(existing ?? {}), ...patch } as SigningEntry;
  data.signing[orderId] = entry;
  await store.write(data);
  return entry;
}

/** Drop an order's signing entry once the checkout settles (or is abandoned). */
export async function clearSigning(orderId: string): Promise<void> {
  const store = driver();
  const data = await store.read();
  if (data.signing?.[orderId]) {
    delete data.signing[orderId];
    await store.write(data);
  }
}
