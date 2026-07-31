import { type NextRequest, NextResponse } from "next/server";
import { getOrder, getSigning, putSigning } from "@/lib/store";

// The browser hands checkout signatures over here, out-of-band: the signing
// card POSTs what the wallet produced, the agent's tools read it from the
// stash. Signatures are public artifacts (they end up at the gateway and
// on-chain); the PRIVATE KEY that made them never touches this server.

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
  if (!(await getOrder(id))) {
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }
  // The entry is created by checkout_begin; a signature for an order with no
  // checkout in progress has nowhere to go.
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
