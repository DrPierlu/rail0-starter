import {
  checksumAddress,
  type PaymentDetail,
  personalSign,
  type SigningPayload,
  signPayment,
} from "@rail0/sdk";
import { env } from "./env";
import { packSignature } from "./rail0";

/**
 * The AGENT'S OWN WALLET: a buyer key held by this deployment, used to buy without a
 * human present.
 *
 * There are two buyers in this template and they are not the same thing. A person
 * shopping in the browser signs with MetaMask — their key is theirs, this app never
 * sees it, and that is the real product. An autonomous agent has no browser and nobody
 * to prompt, so its key has to live somewhere: BUYER_PRIVATE_KEY, here.
 *
 * The key never leaves this process. Signing happens inside the checkout itself
 * (lib/buyer), on payloads this code has just built, so there is no HTTP endpoint that
 * signs what it is handed — an earlier version had one, for the browser, and an
 * endpoint that signs arbitrary data with a funded key is a signing oracle for whoever
 * can reach the deployment. Removing it is what makes it safe for this to be enabled
 * outside local development.
 *
 * Configuring the key IS the switch: set it and this deployment's agent can spend, up
 * to the per-order ceiling below. Two things belong with that decision — the agent's
 * channel (agent/channels/eve.ts) must not be anonymous, or anyone with the URL can
 * direct the spending, and the ceiling should match what you are willing to lose.
 */

/**
 * Whether this deployment has an agent wallet.
 *
 * Pure and separate from `env()` so the predicate is testable. No environment check
 * any more: the capability is deliberate, and the key's presence is the deliberation.
 * (It was gated to `development` while the browser-facing signing route existed —
 * that route is gone, and with it the reason.)
 */
export function agentWalletConfigured(key: string | undefined): boolean {
  return !!key;
}

/** The agent's key, or null when this deployment has none. */
function agentKey(): string | null {
  const key = env().BUYER_PRIVATE_KEY;
  return agentWalletConfigured(key) ? (key ?? null) : null;
}

/**
 * The address the agent buys as, or null when it has no wallet.
 *
 * This is also the answer to "who is the payer" on the autonomous path: the agent buys
 * as ITSELF, not on behalf of a browser session, so nothing has to be carried in from
 * the client context.
 */
export function agentWalletAddress(): string | null {
  const key = agentKey();
  return key ? checksumAddress(key) : null;
}

export type SignRequest =
  | { kind: "message"; message: string }
  | { kind: "typed_data"; payload: SigningPayload };

/**
 * Sign as the agent, or throw when this deployment has no wallet.
 *
 * The two shapes mirror the browser wallet's interface (signMessage / signTypedData)
 * so the checkout can take either signer without branching on more than one line.
 * `signPayment` only reads `signing_payload`, so a minimal object is enough — the same
 * trick the MetaMask path and rail0-admin use.
 */
export function signAsAgent(request: SignRequest): string {
  const key = agentKey();
  if (!key) throw new Error("no agent wallet configured");

  return request.kind === "message"
    ? personalSign(key, request.message)
    : packSignature(
        signPayment(
          key as `0x${string}`,
          {
            signing_payload: request.payload,
          } as PaymentDetail,
        ),
      );
}

/**
 * The largest order the agent may pay for on its own, as a human decimal string.
 *
 * A ceiling exists because signing autonomously removes the guard that used to make
 * the approval on checkout_begin cheap: the comment there reasoned that the wallet
 * already gated the MONEY, since nothing moved without the shopper's two signatures,
 * so the approval only had to cover INTENT. When the agent signs, that is no longer
 * true and the approval becomes the only gate on spending. Rather than delete it or
 * ask every time, the ceiling decides which it is: under it the agent buys, over it a
 * human is asked — the escalation, not a refusal.
 *
 * Default 25.00, deliberately small: an agent that can spend is opt-in, and the amount
 * it can spend unattended should be too. BUYER_MAX_ORDER=0 removes the ceiling.
 */
export function autonomousOrderLimit(): number {
  return env().BUYER_MAX_ORDER;
}

/**
 * Whether `total` is within the ceiling. A ceiling of 0 means no ceiling.
 *
 * Both are human decimals; comparison is numeric, so "9.90" and "9.9" agree. A total
 * that does not parse is NOT within the limit: an amount we cannot read is exactly the
 * case to hand to a person.
 */
export function withinAutonomousLimit(total: string, limit: number): boolean {
  if (limit === 0) return true;
  // Blank first, and explicitly: Number("") and Number(" ") are 0, which is finite and
  // under every ceiling — so an empty total would read as a free order and buy itself.
  if (total.trim() === "") return false;
  const parsed = Number(total);
  return Number.isFinite(parsed) && parsed <= limit;
}
