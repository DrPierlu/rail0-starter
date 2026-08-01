import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

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
  created_at: string;
  updated_at: string;
}

interface StoreData {
  orders: Order[];
}

const EMPTY: StoreData = { orders: [] };

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
