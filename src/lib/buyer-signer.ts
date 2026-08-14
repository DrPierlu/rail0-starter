import {
  checksumAddress,
  type Eip3009Signature,
  type PaymentDetail,
  personalSign,
  type SigningPayload,
  signPayment,
} from "@rail0/sdk";
import { env } from "./env";

/**
 * Server-side signing for a LOCALLY CONFIGURED buyer key.
 *
 * The buyer's signer is normally MetaMask, and the key belongs to the person, not to
 * this app. The one exception is a demo on your own machine: BUYER_PRIVATE_KEY in
 * .env.local lets the buyer flow run end to end without an extension.
 *
 * That key stays HERE. The browser asks this module for a signature and gets back only
 * the signature — the secret never enters the bundle, never crosses the wire, and never
 * sits in a tab's memory where a devtools console or an extension could read it. The
 * alternative (hand the key to the client and sign there, mirroring the MetaMask path)
 * keeps the "buyer signs in their own browser" shape, but a single regression in the
 * environment gate would then serve a private key to every visitor. Signatures are
 * public artifacts anyway: they end up at the gateway and on-chain.
 *
 * This replaced a form that asked the buyer to paste a private key into the page. A
 * key is never pasted now — it is either already configured here, or the buyer connects
 * MetaMask.
 */

/** Pack { v, r, s } into the 65-byte r||s||v hex the gateway expects. */
export function pack(sig: Eip3009Signature): string {
  return `${sig.r}${sig.s.slice(2)}${sig.v.toString(16).padStart(2, "0")}`;
}

/**
 * Whether the configured-buyer signer may be used at all.
 *
 * `development` exactly, not "anything but production": a Vercel preview builds and
 * runs with NODE_ENV=production, but so would any other hosted deployment, and the
 * failure mode of getting this backwards is an endpoint that signs arbitrary payloads
 * with somebody's key for whoever can reach it. A deployed instance therefore has no
 * configured signer and its buyers use MetaMask — which is the intended product
 * anyway. Pure and separate from `env()` so the gate itself is testable.
 */
export function buyerSignerEnabled(input: {
  nodeEnv: string | undefined;
  key: string | undefined;
}): boolean {
  return input.nodeEnv === "development" && !!input.key;
}

/**
 * The configured buyer key, or null when there is none to use.
 *
 * Reads the gate and the value together so no caller can accidentally use one without
 * the other — every route here starts from this function.
 */
export function configuredBuyerKey(): string | null {
  const key = env().BUYER_PRIVATE_KEY;
  return buyerSignerEnabled({ nodeEnv: process.env.NODE_ENV, key }) ? (key ?? null) : null;
}

/** The address the configured key signs as, or null when none is configured. */
export function configuredBuyerAddress(): string | null {
  const key = configuredBuyerKey();
  return key ? checksumAddress(key) : null;
}

export type SignRequest =
  | { kind: "message"; message: string }
  | { kind: "typed_data"; payload: SigningPayload };

/**
 * Sign as the configured buyer, or throw when there is no configured key.
 *
 * The two shapes mirror the browser wallet's own interface (signMessage /
 * signTypedData), so the client can hold one Wallet type whichever backend is behind
 * it. `signPayment` only reads `signing_payload`, so a minimal object is enough — the
 * same trick the MetaMask path and rail0-admin use.
 */
export function signAsBuyer(request: SignRequest): string {
  const key = configuredBuyerKey();
  if (!key) throw new Error("no configured buyer key");

  return request.kind === "message"
    ? personalSign(key, request.message)
    : pack(
        signPayment(
          key as `0x${string}`,
          {
            signing_payload: request.payload,
          } as PaymentDetail,
        ),
      );
}
