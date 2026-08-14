import { checksumAddress, type Eip3009Signature, Rail0Client } from "@rail0/sdk";
import { env } from "./env";

// Two server-side roles, and neither is a human buyer: a person signs in their own
// wallet and their session is stashed with the checkout, not cached here.
//
//   seller — the merchant's backend, signing its own authorize/capture/void.
//   agent  — this deployment's own buyer wallet, when it has one. It needs a session
//            of its own to READ its spending history from the gateway (the budget
//            check in lib/agent-budget); the checkout still logs in per checkout,
//            because that flow's SIWE nonce is single-use and stashed with the order.
type Role = "seller" | "agent";

interface Session {
  client: Rail0Client;
  address: string;
  expiresAt: number; // epoch ms
}

// Sessions survive Next.js dev-server module reloads by living on globalThis.
const globalSessions = globalThis as unknown as {
  __rail0Sessions?: Partial<Record<Role, Session>>;
};
if (!globalSessions.__rail0Sessions) {
  globalSessions.__rail0Sessions = {};
}
const sessions = globalSessions.__rail0Sessions;

function privateKeyFor(role: Role): string {
  if (role === "seller") return env().SELLER_PRIVATE_KEY;
  const key = env().BUYER_PRIVATE_KEY;
  // Callers reach the agent role only after checking it exists; this is the guard for
  // the path that forgets to, and it says which switch is off rather than failing as
  // an unreadable signature later.
  if (!key) throw new Error("no agent wallet configured (BUYER_PRIVATE_KEY)");
  return key;
}

export function addressFor(role: Role): string {
  return checksumAddress(privateKeyFor(role));
}

/**
 * Return a Rail0Client holding a valid SIWE session for the role, logging in
 * on first use and again when the cached JWT is within a minute of expiry.
 * The SIWE message signs the gateway's own host (the gateway accepts an
 * allow-list of domains; its own host is always in it).
 */
export async function clientFor(role: Role): Promise<Rail0Client> {
  const existing = sessions[role];
  if (existing && existing.expiresAt - Date.now() > 60_000) {
    return existing.client;
  }

  const client = existing?.client ?? new Rail0Client({ baseUrl: env().GATEWAY_URL });
  const domain = new URL(env().GATEWAY_URL).host;
  const auth = await client.auth.login(privateKeyFor(role), domain, env().SIWE_CHAIN_ID);
  client.setAuthToken(auth.token);
  sessions[role] = {
    client,
    address: auth.address,
    expiresAt: new Date(auth.expiresAt).getTime(),
  };
  return client;
}

/** Pack a { v, r, s } EIP-3009 signature into the 65-byte hex the gateway expects. */
export function packSignature(sig: Eip3009Signature): string {
  return `${sig.r}${sig.s.slice(2)}${sig.v.toString(16).padStart(2, "0")}`;
}
