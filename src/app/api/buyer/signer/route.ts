import { type NextRequest, NextResponse } from "next/server";
import { configuredBuyerAddress, type SignRequest, signAsBuyer } from "@/lib/buyer-signer";

// The browser's signer when a BUYER_PRIVATE_KEY is configured for local development.
//
// GET  answers with the address that key signs as, so the buyer page can present a
//      connected wallet without asking for anything; 404 when no key is configured,
//      which is how the page decides to offer MetaMask instead.
// POST signs one message or one typed-data payload and returns ONLY the signature.
//
// Both are gated by lib/buyer-signer (development + key present), so on any deployed
// instance this route is a 404 and the buyer uses their own wallet. See that module
// for why the key is not handed to the client instead.

export async function GET() {
  const address = configuredBuyerAddress();
  if (!address) {
    return NextResponse.json({ error: "no configured buyer signer" }, { status: 404 });
  }
  return NextResponse.json({ address });
}

export async function POST(request: NextRequest) {
  if (!configuredBuyerAddress()) {
    return NextResponse.json({ error: "no configured buyer signer" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as Partial<SignRequest>;

  // Validated before signing, and narrowly: this endpoint signs with a key, so the
  // shape it accepts is the shape it can sign — not whatever JSON arrives.
  if (body.kind === "message") {
    if (typeof body.message !== "string" || !body.message) {
      return NextResponse.json({ error: "message must be a non-empty string" }, { status: 422 });
    }
    return NextResponse.json({
      signature: signAsBuyer({ kind: "message", message: body.message }),
    });
  }

  if (body.kind === "typed_data") {
    if (!body.payload || typeof body.payload !== "object") {
      return NextResponse.json({ error: "payload must be a signing payload" }, { status: 422 });
    }
    return NextResponse.json({
      signature: signAsBuyer({ kind: "typed_data", payload: body.payload }),
    });
  }

  return NextResponse.json({ error: "kind must be message or typed_data" }, { status: 422 });
}
