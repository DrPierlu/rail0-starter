import { describe, expect, it } from "vitest";
import {
  type CartLine,
  displayAmount,
  exactAmount,
  type OrderToken,
  orderFrom,
  type PaymentLike,
  packLines,
  stateOf,
  unpackLines,
} from "@/lib/order-view";

const token: OrderToken = {
  chain_id: 5042002,
  symbol: "USDC",
  address: "0x3600000000000000000000000000000000000000",
  decimals: 6,
};

const line = (id: string, qty: number, price = "2.60"): CartLine => ({
  product_id: id,
  name: id.toUpperCase(),
  price,
  qty,
});

describe("stateOf", () => {
  it("reads the status when nothing is in flight", () => {
    expect(stateOf({ status: "signed" })).toBe("awaiting_payment");
    expect(stateOf({ status: "authorized" })).toBe("in_escrow");
    expect(stateOf({ status: "captured" })).toBe("settled");
    expect(stateOf({ status: "partially_captured" })).toBe("settled");
    expect(stateOf({ status: "charged" })).toBe("settled");
    expect(stateOf({ status: "voided" })).toBe("cancelled");
    expect(stateOf({ status: "released" })).toBe("cancelled");
  });

  it("lets an in-flight attempt outrank the status", () => {
    // The status only moves once the attempt confirms. Reading it alone showed
    // `in_escrow` for the whole time a capture was being mined — and a merchant
    // watching that pressed the button a second time.
    expect(
      stateOf({
        status: "authorized",
        transactions: [
          { operation: "authorize", status: "confirmed" },
          { operation: "capture", status: "submitted" },
        ],
      }),
    ).toBe("capturing");

    expect(
      stateOf({ status: "signed", transactions: [{ operation: "authorize", status: "pending" }] }),
    ).toBe("authorizing");

    expect(
      stateOf({
        status: "authorized",
        transactions: [{ operation: "void", status: "submitting" }],
      }),
    ).toBe("voiding");
  });

  it("surfaces a failed attempt rather than looking like nothing happened", () => {
    expect(
      stateOf({
        status: "authorized",
        transactions: [
          { operation: "authorize", status: "confirmed" },
          { operation: "capture", status: "failed" },
        ],
      }),
    ).toBe("failed");
  });

  it("does not let an OLD failure mask a later attempt", () => {
    // Only the last attempt decides: a capture that failed and was retried
    // successfully is settled, not failed.
    expect(
      stateOf({
        status: "captured",
        transactions: [
          { operation: "capture", status: "failed" },
          { operation: "capture", status: "confirmed" },
        ],
      }),
    ).toBe("settled");
  });

  it("falls back to awaiting_payment for anything it does not recognise", () => {
    expect(stateOf({})).toBe("awaiting_payment");
    expect(stateOf({ status: "something_new" })).toBe("awaiting_payment");
  });
});

describe("packLines / unpackLines", () => {
  it("round-trips a cart", () => {
    const lines = [line("tshirts-classic", 2), line("hats-vintage", 1, "2.90")];
    expect(unpackLines(packLines(lines))).toEqual(lines);
  });

  it("keeps the price paid, not today's price", () => {
    // Re-deriving from the catalog would make a later price change rewrite the
    // history of what was already paid.
    const packed = packLines([line("tshirts-classic", 1, "2.60")]);
    expect(packed.lines[0].u).toBe("2.60");
  });

  it("survives metadata that is absent, empty or not ours", () => {
    // It is written by the payer, so it is a claim: a malformed one must read as an
    // empty order, never throw.
    expect(unpackLines(undefined)).toEqual([]);
    expect(unpackLines(null)).toEqual([]);
    expect(unpackLines({})).toEqual([]);
    expect(unpackLines({ lines: "nope" })).toEqual([]);
    expect(unpackLines({ lines: [{ nothing: true }, 42, null] })).toEqual([]);
  });

  it("keeps the valid lines out of a partly malformed list", () => {
    expect(unpackLines({ lines: [{ p: "a", q: 1, u: "1.00" }, { junk: true }] })).toHaveLength(1);
  });

  it("stays well inside the gateway's 4096-byte metadata limit for a real cart", () => {
    const big = Array.from({ length: 40 }, (_, i) => line(`product-number-${i}`, 3, "12.34"));
    expect(JSON.stringify(packLines(big)).length).toBeLessThan(4096);
  });
});

describe("orderFrom", () => {
  const payment: PaymentLike = {
    rail0_id: "0xabc",
    status: "authorized",
    amount: "4490000",
    metadata: packLines([line("tshirts-classic", 1), line("hats-vintage", 1, "1.89")]),
    created_at: "2026-08-14T10:00:00.000Z",
    transactions: [{ operation: "authorize", status: "confirmed" }],
  };

  it("projects the payment into an order", () => {
    const order = orderFrom(payment, token);
    expect(order.id).toBe("0xabc");
    expect(order.rail0_id).toBe("0xabc");
    expect(order.state).toBe("in_escrow");
    // Two decimals, not the token's six: what a person reads must not depend on how
    // many places the chain's stablecoin happens to carry.
    expect(order.total).toBe("4.49");
    expect(order.total_base).toBe("4490000");
    expect(order.lines).toHaveLength(2);
    expect(order.token.symbol).toBe("USDC");
  });

  it("carries the failure of the last attempt", () => {
    const failed = orderFrom(
      {
        ...payment,
        transactions: [{ operation: "capture", status: "failed", error_message: "NotPayee" }],
      },
      token,
    );
    expect(failed.state).toBe("failed");
    expect(failed.error).toBe("NotPayee");
  });

  it("reads an order whose metadata is missing without failing", () => {
    const bare = orderFrom({ rail0_id: "0xdef", status: "signed", amount: "0" }, token);
    expect(bare.lines).toEqual([]);
    expect(bare.state).toBe("awaiting_payment");
    expect(bare.total).toBe("0.00");
  });
});

/**
 * A token's decimals are a property of the chain, and USDC's six turned every total in
 * the app into "1.250000" — in the chat, the order card and the merchant's list. These
 * pin the two halves of the fix: what is SHOWN is always two places, and what is
 * COMPUTED with (a capture asks the gateway for a human decimal amount) keeps all of
 * them.
 */
describe("amount formatting", () => {
  it("shows two decimals whatever the token carries", () => {
    expect(displayAmount("4490000", 6)).toBe("4.49");
    expect(displayAmount("1250000000000000000", 18)).toBe("1.25");
    expect(displayAmount("725", 2)).toBe("7.25");
    expect(displayAmount("7", 0)).toBe("7.00");
    expect(displayAmount("0", 6)).toBe("0.00");
  });

  it("rounds anything finer than a cent to the nearest one, half up", () => {
    // Which cannot arise from this catalog — every price is whole cents — but can from
    // a payment made elsewhere against the same merchant.
    expect(displayAmount("1234567", 6)).toBe("1.23");
    expect(displayAmount("1235000", 6)).toBe("1.24");
    expect(displayAmount("1239999", 6)).toBe("1.24");
    // Dust below half a cent reads as zero, which is the honest rendering of it: the
    // authoritative figure is total_base, and that keeps every digit.
    expect(displayAmount("1", 6)).toBe("0.00");
  });

  it("never throws on an amount it cannot read", () => {
    expect(displayAmount("", 6)).toBe("0.00");
    expect(displayAmount("not a number", 6)).toBe("0.00");
  });

  it("keeps every digit in the exact form", () => {
    expect(exactAmount("4490000", 6)).toBe("4.490000");
    expect(exactAmount("1234567", 6)).toBe("1.234567");
    expect(exactAmount("7", 0)).toBe("7");
  });
});
