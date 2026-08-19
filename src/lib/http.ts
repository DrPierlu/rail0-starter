import { Rail0ApiError } from "@rail0/sdk";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ConfigError } from "./env";
import { ShopError } from "./shop";

// The message names the URL and the fix because "fetch failed" — what the
// merchant panel and the agent showed verbatim — is the single most likely
// first-run failure (no gateway running) and says nothing actionable.
function gatewayUnreachableMessage(): string {
  const url = process.env.RAIL0_GATEWAY_URL || "http://localhost:9292";
  return (
    `rail0 gateway unreachable at ${url} — ` +
    "start it (bin/dev in rail0-gateway) or point RAIL0_GATEWAY_URL at a deployed gateway"
  );
}

// fetch() failures surface as a TypeError("fetch failed") with the socket
// error in `cause`; the SDK rethrows it untouched after its retries.
function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError && error.message === "fetch failed";
}

/** Map thrown errors to a clean JSON error response, mirroring the gateway's shape. */
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ShopError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  // The status on a Rail0ApiError is the GATEWAY's, and only some of it is ours to
  // repeat. A 5xx upstream is a bad gateway — and so is a 404: it says the PAYMENT
  // is unknown *there* (a gateway redeployed on a fresh database, a pruned payment,
  // a transient routing 404), never that the resource this route names is missing.
  // Echoed verbatim it became "the order does not exist" to every caller, and the
  // buyer's order card latched on it: "order not found" forever, polling stopped,
  // for an order sitting in the store.
  if (error instanceof Rail0ApiError) {
    const upstream = error.status >= 500 || error.status === 404;
    return NextResponse.json({ error: error.message }, { status: upstream ? 502 : error.status });
  }
  // A malformed request body (schema.parse in a route): the caller's fault,
  // with the offending fields named — not a 500.
  if (error instanceof ZodError) {
    const detail = error.issues
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
      .join("; ");
    return NextResponse.json({ error: `invalid request: ${detail}` }, { status: 400 });
  }
  // Missing/malformed env: a deployment problem, and the message says which
  // variable and where to fix it (see ConfigError in env.ts).
  if (error instanceof ConfigError) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (isNetworkError(error)) {
    return NextResponse.json({ error: gatewayUnreachableMessage() }, { status: 502 });
  }
  const message = error instanceof Error ? error.message : "internal error";
  return NextResponse.json({ error: message }, { status: 500 });
}
