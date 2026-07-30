import { Rail0ApiError } from "@rail0/sdk";
import { NextResponse } from "next/server";
import { ShopError } from "./shop";

/** Map thrown errors to a clean JSON error response, mirroring the gateway's shape. */
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ShopError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Rail0ApiError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status >= 500 ? 502 : error.status },
    );
  }
  const message = error instanceof Error ? error.message : "internal error";
  return NextResponse.json({ error: message }, { status: 500 });
}
