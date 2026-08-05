import { headers } from "next/headers";
import { MerchantDashboard } from "./dashboard";

/**
 * Hands the merchant token to the browser ONLY when this page is being served
 * locally, so a demo does not stop to ask for a secret nobody in the room knows.
 *
 * Two conditions, both required, because either alone is too weak:
 *
 *   NODE_ENV !== "production" — the usual gate, but on its own it is one missing
 *   env var away from shipping the token to every visitor of a real deployment.
 *
 *   the request's Host is loopback — a deployed app is reached by its domain, never
 *   by localhost, so this is what makes an accidental leak essentially impossible.
 *   It is not a security boundary on its own (a Host header is client-supplied), which
 *   is exactly why it is ANDed with the build-time check rather than trusted alone.
 *
 * What this deliberately does NOT do is weaken the gate. The token is still required,
 * still compared in constant time, still exchanged for the same httpOnly cookie — the
 * only difference is who types it. The alternative asked for originally, embedding the
 * token in the page unconditionally, would have handed it to every visitor: /merchant
 * itself is not protected, which is the whole reason the endpoints behind it are.
 */
async function localDevToken(): Promise<string | undefined> {
  if (process.env.NODE_ENV === "production") return undefined;

  const token = process.env.MERCHANT_TOKEN;
  if (!token) return undefined;

  // Host carries the port ("localhost:4000"); IPv6 arrives bracketed ("[::1]:4000").
  const host = (await headers()).get("host") ?? "";
  const hostname = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

  return local ? token : undefined;
}

export default async function MerchantPage() {
  return <MerchantDashboard devToken={await localDevToken()} />;
}
