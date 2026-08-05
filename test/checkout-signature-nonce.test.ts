import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/checkout/[id]/signature/route";
import { getSigning, putSigning } from "@/lib/checkout-signing";

// The bug these pin: the signature drop-box's only gate was "an entry exists for this
// order id". Order ids are 8 hex characters and are not secret — they travel through
// the chat and the merchant's order list — so a guessed id was enough to overwrite the
// buyer's stashed signatures with garbage and kill the checkout on signer_mismatch,
// once per guess. Depositing now requires the per-checkout nonce minted at
// checkout_begin.

process.env.STARTER_DATA_DIR = mkdtempSync(path.join(tmpdir(), "starter-data-"));

const NONCE = "a".repeat(64);
const SIGNATURE = `0x${"ab".repeat(65)}`;
const OTHER_SIGNATURE = `0x${"cd".repeat(65)}`;

const deposit = (id: string, body: unknown) =>
  POST(
    new NextRequest(`http://localhost:4000/api/checkout/${id}/signature`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

let orderId: string;

beforeEach(async () => {
  // A fresh order id per test, so a stash left behind cannot make the next one pass.
  orderId = Math.random().toString(16).slice(2, 10);
  await putSigning(orderId, {
    address: "0x1111111111111111111111111111111111111111",
    siwe_message: "localhost wants you to sign in…",
    deposit_nonce: NONCE,
  });
});

describe("POST /api/checkout/[id]/signature", () => {
  it("accepts a deposit carrying the checkout's nonce", async () => {
    const response = await deposit(orderId, { kind: "siwe", signature: SIGNATURE, nonce: NONCE });

    expect(response.status).toBe(200);
    expect((await getSigning(orderId))?.siwe_signature).toBe(SIGNATURE);
  });

  it("refuses a deposit with the wrong nonce, leaving the stash untouched", async () => {
    await deposit(orderId, { kind: "siwe", signature: SIGNATURE, nonce: NONCE });

    const response = await deposit(orderId, {
      kind: "siwe",
      signature: OTHER_SIGNATURE,
      nonce: "b".repeat(64),
    });

    expect(response.status).toBe(403);
    // The point of the gate: the signature the buyer really produced survives.
    expect((await getSigning(orderId))?.siwe_signature).toBe(SIGNATURE);
  });

  // Knowing the id is no longer enough — which is the whole fix.
  it("refuses a deposit with no nonce at all", async () => {
    const response = await deposit(orderId, { kind: "eip3009", signature: SIGNATURE });

    expect(response.status).toBe(403);
    expect((await getSigning(orderId))?.eip3009_signature).toBeUndefined();
  });

  // A nonce of the wrong length must be a refusal, not the 500 an unguarded
  // timingSafeEqual would raise (see tokenMatches).
  it("refuses a short nonce without throwing", async () => {
    const response = await deposit(orderId, { kind: "siwe", signature: SIGNATURE, nonce: "a" });
    expect(response.status).toBe(403);
  });

  // Still distinguishable from a wrong nonce on purpose: a legitimate browser whose
  // stash expired has to be told the checkout is gone, not that it presented the
  // wrong secret.
  it("still answers 409 when no checkout is in progress", async () => {
    const response = await deposit("deadbeef", {
      kind: "siwe",
      signature: SIGNATURE,
      nonce: NONCE,
    });
    expect(response.status).toBe(409);
  });

  it("validates the body before looking at the checkout", async () => {
    expect(
      (await deposit(orderId, { kind: "nope", signature: SIGNATURE, nonce: NONCE })).status,
    ).toBe(422);
    expect((await deposit(orderId, { kind: "siwe", signature: "0x12", nonce: NONCE })).status).toBe(
      422,
    );
  });
});

describe("putSigning", () => {
  // An entry without a nonce would be a drop-box nobody can post to.
  it("refuses to create an entry that carries no nonce", async () => {
    const entry = await putSigning("cafebabe", {
      address: "0x2222222222222222222222222222222222222222",
      siwe_message: "localhost wants you to sign in…",
    });

    expect(entry).toBeUndefined();
    expect(await getSigning("cafebabe")).toBeUndefined();
  });

  it("keeps the first write's nonce across later patches", async () => {
    await putSigning(orderId, { rail0_id: `0x${"11".repeat(32)}` });
    expect((await getSigning(orderId))?.deposit_nonce).toBe(NONCE);
  });
});
