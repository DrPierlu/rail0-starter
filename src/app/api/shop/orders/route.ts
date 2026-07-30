import { toBaseUnits } from "@rail0/sdk";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fromCents, getProduct, toCents } from "@/lib/catalog";
import { errorResponse } from "@/lib/http";
import { addressFor } from "@/lib/rail0";
import { listPaymentMethods, refreshOrder, ShopError } from "@/lib/shop";
import { type CartLine, createOrder, listOrders } from "@/lib/store";

const createSchema = z.object({
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

export async function GET() {
  try {
    const stored = await listOrders();
    const orders = await Promise.all(stored.map((o) => refreshOrder(o.id)));
    return NextResponse.json({ orders });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Create an order for the given items, priced in the chosen chain/token pair.
 * The pair must be one the merchant actually accepts (validated against the
 * gateway's public payment methods), and the response carries the payment
 * instructions the buyer needs: payee address and total in token base units.
 */
export async function POST(request: NextRequest) {
  try {
    const body = createSchema.parse(await request.json());

    const methods = await listPaymentMethods();
    const method = methods.find(
      (m) =>
        m.chain_id === body.chain_id &&
        m.address.toLowerCase() === body.token_address.toLowerCase(),
    );
    if (!method) {
      throw new ShopError(422, "merchant does not accept this chain/token pair");
    }

    const lines: CartLine[] = [];
    let totalCents = 0n;
    for (const item of body.items) {
      const product = getProduct(item.product_id);
      if (!product) {
        throw new ShopError(422, `unknown product: ${item.product_id}`);
      }
      lines.push({
        product_id: product.id,
        name: product.name,
        price: product.price,
        qty: item.qty,
      });
      totalCents += toCents(product.price) * BigInt(item.qty);
    }
    const total = fromCents(totalCents);

    const order = await createOrder(lines, total, toBaseUnits(total, method.decimals), {
      chain_id: method.chain_id,
      chain_name: method.chain_name,
      symbol: method.symbol,
      address: method.address,
      decimals: method.decimals,
    });

    return NextResponse.json(
      {
        order,
        payment_instructions: {
          payee: addressFor("seller"),
          chain_id: method.chain_id,
          token: method.address,
          // The gateway's POST /payments takes the HUMAN decimal amount and
          // converts to base units itself; amount_base is informative only.
          amount: order.total,
          amount_base: order.total_base,
          mode: "authorize",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
