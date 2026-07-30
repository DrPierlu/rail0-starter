import { type NextRequest, NextResponse } from "next/server";
import { listCategories, listProducts, merchantName } from "@/lib/catalog";
import { addressFor } from "@/lib/rail0";

export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get("category") ?? undefined;
  const search = request.nextUrl.searchParams.get("search") ?? undefined;
  return NextResponse.json({
    merchant: { name: merchantName(), address: addressFor("seller") },
    categories: listCategories(),
    products: listProducts({ category, search }),
  });
}
