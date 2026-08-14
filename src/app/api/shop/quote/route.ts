import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { quoteFor } from "@/lib/shop";

const schema = z.object({
  items: z
    .array(
      z.object({
        product_id: z.string(),
        qty: z.number().int().positive().default(1),
      }),
    )
    .min(1),
  chain_id: z.number().int(),
  token_address: z.string(),
});

/**
 * Checkout step 1: what these items cost, in the chain/token the buyer picked.
 *
 * It creates nothing. This used to be POST /api/shop/orders, which minted an order and
 * stored it — and the store then had to be reconciled with the payment that arrived
 * later. The quote is a statement of price, not a reservation: what binds the two sides
 * is the payment the buyer creates next, and the merchant re-prices its claim before
 * escrowing anything (shop.ts, authorizePayment).
 *
 * Public, like the catalog it prices from: quoting is shopping.
 */
export async function POST(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const quote = await quoteFor(body.items, body.chain_id, body.token_address);
    return NextResponse.json(quote);
  } catch (error) {
    return errorResponse(error);
  }
}
