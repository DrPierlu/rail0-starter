import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { captureOrder } from "@/lib/shop";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ order: await captureOrder(id) }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
