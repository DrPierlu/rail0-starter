import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { refreshOrder } from "@/lib/shop";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ order: await refreshOrder(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
