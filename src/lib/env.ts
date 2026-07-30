import { z } from "zod";

const schema = z.object({
  GATEWAY_URL: z.string().url().default("http://localhost:9292"),
  BUYER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, {
    message: "BUYER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key",
  }),
  SELLER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, {
    message: "SELLER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key",
  }),
  SIWE_CHAIN_ID: z.coerce.number().int().default(1),
  AI_MODEL: z.string().default("claude-sonnet-5"),
  APP_URL: z.string().url().default("http://localhost:3000"),
});

type Env = z.infer<typeof schema>;

let cached: Env | null = null;

// Parsed lazily (not at import time) so `next build` succeeds without the
// secrets being present — they are only required once a route actually runs.
export function env(): Env {
  if (!cached) {
    cached = schema.parse({
      GATEWAY_URL: process.env.GATEWAY_URL || undefined,
      BUYER_PRIVATE_KEY: process.env.BUYER_PRIVATE_KEY,
      SELLER_PRIVATE_KEY: process.env.SELLER_PRIVATE_KEY,
      SIWE_CHAIN_ID: process.env.SIWE_CHAIN_ID || undefined,
      AI_MODEL: process.env.AI_MODEL || undefined,
      APP_URL:
        process.env.APP_URL ||
        (process.env.VERCEL_PROJECT_PRODUCTION_URL
          ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
          : undefined),
    });
  }
  return cached;
}
