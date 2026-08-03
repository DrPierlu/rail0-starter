import { type NextRequest, NextResponse } from "next/server";
import { listCategories, listProducts, merchantName } from "@/lib/catalog";
import { errorResponse } from "@/lib/http";
import { addressFor } from "@/lib/rail0";

export async function GET(request: NextRequest) {
  try {
    const category = request.nextUrl.searchParams.get("category") ?? undefined;
    const search = request.nextUrl.searchParams.get("search") ?? undefined;
    return NextResponse.json({
      merchant: { name: merchantName(), address: addressFor("seller") },
      categories: listCategories(),
      products: listProducts({ category, search }),
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
