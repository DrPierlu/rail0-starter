import { type NextRequest, NextResponse } from "next/server";
import { listCategories, listProducts, merchantName } from "@/lib/catalog";
import { errorResponse } from "@/lib/http";
import { addressFor } from "@/lib/rail0";

/**
 * How many products an unfiltered listing hands back.
 *
 * The whole catalog is ~30 KB of JSON, and this endpoint's main caller is a language
 * model that pays for every byte of it on every turn of the conversation that follows.
 * A category (ten items) or a search always fits under the cap, so narrowing is what the
 * agent is nudged towards — and the count below tells it, and the shopper, what was left
 * out rather than pretending the catalog is this small.
 */
const PAGE_LIMIT = 24;

export async function GET(request: NextRequest) {
  try {
    const category = request.nextUrl.searchParams.get("category") ?? undefined;
    const search = request.nextUrl.searchParams.get("search") ?? undefined;
    const matches = listProducts({ category, search });
    return NextResponse.json({
      merchant: { name: merchantName(), address: addressFor("seller") },
      categories: listCategories(),
      total: matches.length,
      products: matches.slice(0, PAGE_LIMIT),
    });
  } catch (error) {
    // This WAS the only route without the catch — and, via addressFor → env(),
    // the first place a missing SELLER_PRIVATE_KEY surfaced. list_products is
    // the first tool call of virtually every conversation, so the un-caught
    // ZodError turned into a bare non-JSON 500 and the new user's very first
    // error read `Unexpected token 'I', "Internal S"... is not valid JSON`
    // instead of the message env.ts had carefully written.
    return errorResponse(error);
  }
}
