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
  // No BUYER_PRIVATE_KEY on this branch, by design: the buyer signs in the
  // browser (MetaMask or a pasted key that never leaves it). Only the SELLER
  // key lives server-side — the merchant's own backend signing its own txs.
  SELLER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, {
    message: "SELLER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key",
  }),
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
