import { type NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { requireMerchant } from "@/lib/merchant-auth";
import { voidOrder } from "@/lib/shop";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Before the params are even read: void hands the escrow back and cancels
    // the order.
    requireMerchant(request);
    const { id } = await params;
    return NextResponse.json({ order: await voidOrder(id) }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
