import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addToCart,
  clearCart,
  createOrder,
  getCart,
  getOrder,
  listOrders,
  type OrderToken,
  removeFromCart,
  updateOrder,
} from "@/lib/store";

const TOKEN: OrderToken = {
  chain_id: 84532,
  symbol: "USDC",
  address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  decimals: 6,
};

let dir: string;
let originalCwd: string;

beforeAll(() => {
  originalCwd = process.cwd();
  dir = mkdtempSync(path.join(tmpdir(), "rail0-starter-store-"));
  process.chdir(dir);
});

afterAll(() => {
  process.chdir(originalCwd);
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await clearCart();
});

describe("cart", () => {
  it("adds, merges, removes and clears lines", async () => {
    await addToCart({ product_id: "a", name: "A", price: "1.00", qty: 1 });
    await addToCart({ product_id: "a", name: "A", price: "1.00", qty: 2 });
    await addToCart({ product_id: "b", name: "B", price: "2.00", qty: 1 });
    expect(await getCart()).toHaveLength(2);
    expect((await getCart()).find((l) => l.product_id === "a")?.qty).toBe(3);

    await removeFromCart("a", 1);
    expect((await getCart()).find((l) => l.product_id === "a")?.qty).toBe(2);
    await removeFromCart("a");
    expect((await getCart()).find((l) => l.product_id === "a")).toBeUndefined();

    await clearCart();
    expect(await getCart()).toHaveLength(0);
  });
});

describe("orders", () => {
  it("creates orders in awaiting_payment and finds them by id or rail0_id", async () => {
    const order = await createOrder(
      [{ product_id: "a", name: "A", price: "1.00", qty: 2 }],
      "2.00",
      "2000000",
      TOKEN,
    );
    expect(order.state).toBe("awaiting_payment");
    expect((await getOrder(order.id))?.id).toBe(order.id);

    const rail0Id = `0x${"ab".repeat(32)}`;
    await updateOrder(order.id, { rail0_id: rail0Id, state: "authorizing" });
    expect((await getOrder(rail0Id))?.id).toBe(order.id);
    expect((await getOrder(order.id))?.state).toBe("authorizing");
  });

  it("lists orders newest first", async () => {
    const first = await createOrder([], "1.00", "1000000", TOKEN);
    const second = await createOrder([], "2.00", "2000000", TOKEN);
    const ids = (await listOrders()).map((o) => o.id);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
  });

  it("returns undefined when updating a missing order", async () => {
    expect(await updateOrder("missing", { state: "settled" })).toBeUndefined();
  });
});
