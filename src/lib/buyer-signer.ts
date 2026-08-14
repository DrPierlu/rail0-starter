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
 * to the ceilings in lib/agent-budget. Two things belong with that decision — the
 * agent's channel (agent/channels/eve.ts) must not be anonymous, or anyone with the URL
 * can direct the spending, and the ceilings should match what you are willing to lose.
 *
 * The ceilings live beside the key rather than in the agent's instructions, and that is
 * the point: the model never holds the key, so it must not hold the limit on the key
 * either. An instruction is read by something that also reads product descriptions
 * written by strangers; a ceiling is not.
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
