// The buyer tools run inside the eve agent service, not inside a Next request
// handler — so there is no request origin to derive the storefront base from
// (the AI SDK variant on main derives it per-request). The service still
// targets this same app: SHOP_URL overrides when set, the Vercel production
// URL covers the deployed case, and localhost covers `bin/dev`.
export function shopBase(): string {
  if (process.env.SHOP_URL) return process.env.SHOP_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "http://localhost:3000";
}
