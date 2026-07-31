import { z } from "zod";

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
});

type Env = z.infer<typeof schema>;

let cached: Env | null = null;

// Parsed lazily (not at import time) so `next build` succeeds without the
// secrets being present — they are only required once a route actually runs.
export function env(): Env {
  if (!cached) {
    cached = schema.parse({
      GATEWAY_URL: process.env.GATEWAY_URL || undefined,
      SELLER_PRIVATE_KEY: process.env.SELLER_PRIVATE_KEY,
      SIWE_CHAIN_ID: process.env.SIWE_CHAIN_ID || undefined,
      AI_MODEL: process.env.AI_MODEL || undefined,
    });
  }
  return cached;
}
