import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Rail0ApiError } from "@rail0/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorResponse } from "@/lib/http";
import { ShopError } from "@/lib/shop";

// The bug these pin: GET /api/shop/orders/[id] refreshes the order from the gateway,
// and a 404 FROM THE GATEWAY (redeployed on a fresh database, a pruned payment, a
// transient routing 404) was answered as a 404 for the order. The buyer's card treats
// a 404 as terminal — "order not found", polling stopped — for an order that is in the
// store. The route now falls back to the stored snapshot flagged `stale`, the way the
// merchant's order list already did, and only an unknown id still answers 404.

// The store is real (a temp directory, like doc-store.test.ts); only the half that
// talks to the gateway is stubbed.
process.env.STARTER_DATA_DIR = mkdtempSync(path.join(tmpdir(), "starter-data-"));
process.env.SELLER_PRIVATE_KEY = `0x${"11".repeat(32)}`;

const refreshOrder = vi.fn();
vi.mock("@/lib/shop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/shop")>()),
  refreshOrder: (id: string) => refreshOrder(id),
}));

const { GET } = await import("@/app/api/shop/orders/[id]/route");
const { createOrder } = await import("@/lib/store");

const token = {
  chain_id: 84532,
  chain_name: "Base Sepolia",
  symbol: "USDC",
  address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  decimals: 6,
};

const read = (id: string) =>
  GET(new Request(`http://localhost:4000/api/shop/orders/${id}`), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  refreshOrder.mockReset();
});

describe("GET /api/shop/orders/[id]", () => {
  it("answers the stored snapshot, flagged stale, when the gateway 404s the payment", async () => {
    const order = await createOrder([], "5.20", "5200000", token);
    refreshOrder.mockRejectedValue(new Rail0ApiError(404, { status: "not_found" }));

    const response = await read(order.id);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { order: { id: string; stale?: boolean } };
    expect(body.order.id).toBe(order.id);
    expect(body.order.stale).toBe(true);
  });

  // Same fallback for a gateway that cannot be reached at all: the order exists, the
  // refresh does not, and the card must keep polling.
  it("answers the stored snapshot when the gateway is unreachable", async () => {
    const order = await createOrder([], "1.00", "1000000", token);
    refreshOrder.mockRejectedValue(new TypeError("fetch failed"));

    const response = await read(order.id);

    expect(response.status).toBe(200);
    expect((await response.json()).order.stale).toBe(true);
  });

  it("still answers 404 for an id the store does not know", async () => {
    refreshOrder.mockRejectedValue(new ShopError(404, "order not found"));

    const response = await read("deadbeef");

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("order not found");
  });
});

describe("errorResponse", () => {
  // A gateway 404 is an upstream failure, like a gateway 5xx — not this app's 404.
  it("maps a gateway 404 to 502 instead of repeating it", async () => {
    const response = errorResponse(new Rail0ApiError(404, { status: "not_found" }));
    expect(response.status).toBe(502);
  });

  it("still repeats the gateway's other client-error statuses", () => {
    expect(errorResponse(new Rail0ApiError(422, { status: "invalid_state" })).status).toBe(422);
    expect(errorResponse(new Rail0ApiError(401, { status: "unauthorized" })).status).toBe(401);
    expect(errorResponse(new Rail0ApiError(503, { status: "unavailable" })).status).toBe(502);
  });
});
