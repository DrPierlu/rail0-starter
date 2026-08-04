// The buyer tools run inside the eve agent service, not inside a Next request
// handler — so there is no request origin to derive the storefront base from
// (the AI SDK variant on main derives it per-request). The service still
// targets this same app: SHOP_URL overrides when set, the Vercel production
// URL covers the deployed case, and localhost covers `bin/dev`.
//
// The local fallback is 4000, matching the port `pnpm dev` binds. It used to be
// 3000, which in a full local rail0 stack is rail0-admin: the agent's shop calls
// went to a DIFFERENT application that answers them, rather than to nothing —
// a worse failure than the "storefront that isn't there" .env.example warns about.
// bin/dev also exports SHOP_URL from the port it launched, so the two cannot drift.
export const LOCAL_SHOP_PORT = 4000;

export function shopBase(): string {
  if (process.env.SHOP_URL) return process.env.SHOP_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return `http://localhost:${LOCAL_SHOP_PORT}`;
}
