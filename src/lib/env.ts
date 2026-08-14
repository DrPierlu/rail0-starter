import { z } from "zod";

/**
 * A missing/malformed environment variable, distinct from every runtime error:
 * the fix is in .env.local, not in the request. errorResponse maps it to a 500
 * that SAYS so — before, the ZodError escaped as a bare non-JSON 500 whose
 * downstream symptom was the agent showing `Unexpected token 'I', "Internal
 * S"... is not valid JSON` on the very first tool call of a conversation.
 */
export class ConfigError extends Error {}

const schema = z.object({
  GATEWAY_URL: z.string().url().default("http://localhost:9292"),
  SELLER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, {
    message: "SELLER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key",
  }),
  // The AGENT'S wallet: set it and this deployment's agent can buy on its own,
  // up to BUYER_MAX_ORDER. Unset, the buyer is a person with MetaMask and the
  // checkout waits for their signatures. Optional HERE and required by whatever
  // reads it (lib/buyer-signer), like MERCHANT_TOKEN — the app must run fine
  // without it, because running without it is the normal case.
  BUYER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, {
      message: "BUYER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key",
    })
    .optional(),
  // Largest order the agent pays for unattended, as a decimal in the payment
  // stablecoin. 0 removes the ceiling. Over it, the checkout asks a human to
  // approve rather than refusing — see lib/agent-budget for why a ceiling has to
  // exist once the agent holds the key.
  BUYER_MAX_ORDER: z.coerce.number().nonnegative().default(25),
  // The ceiling that survives "New conversation". A per-session budget can live in
  // eve's own state, but a new session resets it — and starting one is a button in
  // the chat, so a session-scoped cap is a cap the user can clear by clicking. This
  // one is answered from the gateway's record of what the agent actually paid, over
  // a rolling window. 0 removes it.
  BUYER_MAX_WINDOW: z.coerce.number().nonnegative().default(100),
  BUYER_WINDOW_HOURS: z.coerce.number().positive().default(24),
  SIWE_CHAIN_ID: z.coerce.number().int().default(1),
  AI_MODEL: z.string().default("claude-sonnet-5"),
  // Optional HERE and required by the gate that reads it (lib/merchant-auth.ts):
  // the buyer's routes must keep working without it, while the merchant's refuse
  // to run at all — a schema-level requirement would take the whole app down
  // instead of just the surface the token protects.
  MERCHANT_TOKEN: z.string().min(1).optional(),
});

type Env = z.infer<typeof schema>;

let cached: Env | null = null;

// Parsed lazily (not at import time) so `next build` succeeds without the
// secrets being present — they are only required once a route actually runs.
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse({
      GATEWAY_URL: process.env.GATEWAY_URL || undefined,
      SELLER_PRIVATE_KEY: process.env.SELLER_PRIVATE_KEY,
      BUYER_PRIVATE_KEY: process.env.BUYER_PRIVATE_KEY || undefined,
      BUYER_MAX_ORDER: process.env.BUYER_MAX_ORDER || undefined,
      BUYER_MAX_WINDOW: process.env.BUYER_MAX_WINDOW || undefined,
      BUYER_WINDOW_HOURS: process.env.BUYER_WINDOW_HOURS || undefined,
      SIWE_CHAIN_ID: process.env.SIWE_CHAIN_ID || undefined,
      AI_MODEL: process.env.AI_MODEL || undefined,
      MERCHANT_TOKEN: process.env.MERCHANT_TOKEN || undefined,
    });
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
        .join("; ");
      throw new ConfigError(`configuration error — check .env.local: ${detail}`);
    }
    cached = parsed.data;
  }
  return cached;
}
