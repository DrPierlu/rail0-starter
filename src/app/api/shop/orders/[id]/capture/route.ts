import { type NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { requireMerchant } from "@/lib/merchant-auth";
import { captureOrder } from "@/lib/shop";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Before the params are even read: capture settles real escrowed funds.
    requireMerchant(request);
    const { id } = await params;
    return NextResponse.json({ order: await captureOrder(id) }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
