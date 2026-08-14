// Where the STOREFRONT is, as seen from the buyer side.
//
// The two sides are separate deployables in principle — the merchant's endpoints and
// the buyer's agent could live on different hosts — so the buyer never reaches the shop
// by calling its functions, only over HTTP at this base. In the default deployment it
// is this same app, which is what makes the split cheap to keep.
//
// It lives in src/lib rather than agent/lib because both sides need it now: the agent
// service has no request to derive an origin from, and the checkout routes must call
// the storefront by the same rule the agent does or the two could target different
// applications.
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
