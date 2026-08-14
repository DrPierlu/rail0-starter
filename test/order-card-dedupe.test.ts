import { describe, expect, it } from "vitest";
import { orderCardOrderId } from "@/app/buyer/tool-views";

// While a payment confirms, the agent calls order_status repeatedly, and each output
// rendered its own OrderCard — four identical cards for one order. OrderCard polls
// /api/shop/orders/{id} itself, so each copy was another 3s loop, each doing a
// read-modify-write on the store. The transcript keeps the FIRST card, which needs a
// reliable answer to "which order does this part put a card on screen for". Only the
// AUTONOMOUS checkout carries one: the human flow has no order when its tool returns.
describe("orderCardOrderId", () => {
  it("reads the order from checkout_begin", () => {
    expect(orderCardOrderId("checkout_begin", { order_id: "84aa1a40" })).toBe("84aa1a40");
  });

  it("reads the order from a nested order_status result", () => {
    expect(orderCardOrderId("order_status", { order: { id: "84aa1a40" } })).toBe("84aa1a40");
  });

  // The two must agree, or the same order renders twice — once per shape.
  it("gives both tools the same id for the same order", () => {
    expect(orderCardOrderId("order_status", { order: { id: "84aa1a40" } })).toBe(
      orderCardOrderId("checkout_begin", { order_id: "84aa1a40" }),
    );
  });

  it("ignores tools that render no card", () => {
    expect(orderCardOrderId("list_products", { products: [] })).toBeUndefined();
    expect(orderCardOrderId("my_orders", { orders: [{ id: "84aa1a40" }] })).toBeUndefined();
  });

  // A malformed or partial output must not produce a key that would wrongly supersede a
  // real card (or be superseded by one).
  it("returns nothing for a missing or non-string id", () => {
    expect(orderCardOrderId("checkout_begin", undefined)).toBeUndefined();
    expect(orderCardOrderId("checkout_begin", {})).toBeUndefined();
    expect(orderCardOrderId("order_status", { order: {} })).toBeUndefined();
    expect(orderCardOrderId("order_status", { order: { id: 42 } })).toBeUndefined();
  });
});
