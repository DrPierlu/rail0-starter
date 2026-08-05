import { type NextRequest, NextResponse } from "next/server";
import { getSigning, putSigning } from "@/lib/checkout-signing";
// The merchant gate's constant-time compare, reused rather than copied: the nonce
// below is a secret compared against a stored one, which is the same job, and a
// second implementation is a second chance to get timingSafeEqual's throw-on-
// mismatched-length wrong. Nothing merchant-specific comes with it.
import { tokenMatches } from "@/lib/merchant-auth";

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
  /** The checkout's deposit nonce, from the signing card's tool output. */
  nonce?: string;
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
  const entry = await getSigning(id);
  if (!entry) {
    return NextResponse.json({ error: "no checkout in progress for this order" }, { status: 409 });
  }

  // The actual gate. "An entry exists for this id" was not one: order ids are 8 hex
  // characters and are not secret (they go through the chat, and the merchant's own
  // order list hands them out), so anyone who guessed or learned one could POST
  // garbage here and overwrite the buyer's stashed signatures mid-checkout. Nothing
  // leaked — auth_token is not readable through this route — but the checkout then
  // died on signer_mismatch or a verify failure, once per guess.
  //
  // Constant-time, and length-checked first (tokenMatches): a nonce of the wrong
  // length would otherwise make timingSafeEqual throw, i.e. a 500 instead of a
  // refusal. The 409 above is deliberately still distinguishable from this 403 —
  // the id is not the secret, and a legitimate browser whose stash has expired
  // needs to be told that rather than "wrong nonce".
  //
  // An entry stashed before nonces existed has none: refuse it (the checkout is
  // restartable) rather than fall open or crash on an undefined expected value.
  if (!entry.deposit_nonce || !tokenMatches(body.nonce ?? "", entry.deposit_nonce)) {
    return NextResponse.json({ error: "invalid checkout nonce" }, { status: 403 });
  }

  await putSigning(
    id,
    body.kind === "siwe"
      ? { siwe_signature: body.signature }
      : { eip3009_signature: body.signature },
  );
  return NextResponse.json({ ok: true });
}
