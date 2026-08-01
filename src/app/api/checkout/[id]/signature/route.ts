import { type NextRequest, NextResponse } from "next/server";
import { getSigning, putSigning } from "@/lib/checkout-signing";

// The browser hands checkout signatures over here, out-of-band: the signing card
// POSTs what the wallet produced, the agent's tools read it from the stash.
// Signatures are public artifacts (they end up at the gateway and on-chain); the
// PRIVATE KEY that made them never touches this server.
//
// Deliberately /api/checkout and NOT /api/shop: this endpoint belongs to the BUYER
// AGENT, not the merchant. It sat under the merchant's namespace, sharing a store
// with it, which both broke the split (separate deployments = separate stores, so
// the agent would read an empty stash forever) and handed the merchant the buyer's
// gateway JWT. The browser and the agent are the same deployable; the merchant is
// the other one. (#6)

interface Body {
  kind?: "siwe" | "eip3009";
  signature?: string;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Body;

  if (body.kind !== "siwe" && body.kind !== "eip3009") {
    return NextResponse.json({ error: "kind must be siwe or eip3009" }, { status: 422 });
  }
  if (!/^0x[0-9a-fA-F]{100,}$/.test(body.signature ?? "")) {
    return NextResponse.json({ error: "signature must be a 0x hex string" }, { status: 422 });
  }
  // No order lookup here: orders belong to the merchant, and this route no longer
  // shares a process with it. The stash IS the authority on whether a checkout is
  // in progress — checkout_begin creates the entry, and a signature for an order
  // with no entry has nowhere to go regardless of whether that order exists.
  if (!(await getSigning(id))) {
    return NextResponse.json({ error: "no checkout in progress for this order" }, { status: 409 });
  }

  await putSigning(
    id,
    body.kind === "siwe"
      ? { siwe_signature: body.signature }
      : { eip3009_signature: body.signature },
  );
  return NextResponse.json({ ok: true });
}
