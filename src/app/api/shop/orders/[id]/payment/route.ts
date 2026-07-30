import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { attachPaymentAndAuthorize } from "@/lib/shop";

const schema = z.object({
  rail0_id: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { rail0_id } = schema.parse(await request.json());
    const order = await attachPaymentAndAuthorize(id, rail0_id);
    return NextResponse.json({ order }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
