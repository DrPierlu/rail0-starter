import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { listPaymentMethods } from "@/lib/shop";

export async function GET() {
  try {
    return NextResponse.json({ payment_methods: await listPaymentMethods() });
  } catch (error) {
    return errorResponse(error);
  }
}
