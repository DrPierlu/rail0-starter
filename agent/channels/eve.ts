import { none } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

/**
 * Who may talk to the agent. Authored because the default is FAIL-CLOSED and would have
 * rejected every visitor of the deployed demo.
 *
 * With no file here eve registers `eveChannel({ auth: [vercelOidc(), localDev()] })`.
 * `localDev()` opens loopback only — its implementation accepts `localhost`, `[::1]`,
 * `127.*` and `*.localhost`, plus `VERCEL_ENV === "development"` — and `vercelOidc()`
 * wants a Vercel OIDC bearer that a browser does not carry. So the chat worked on
 * localhost and answered 401 on Vercel, which is the one deployment target the README
 * documents.
 *
 * `none()` is what the docs prescribe for a public demo, and that is what this template
 * is: an anonymous shopper browses a catalog and pays from their own wallet. There is no
 * account to authenticate and nothing the session can reach on anyone's behalf — the
 * buyer's key never leaves their browser, and the merchant side is gated separately by
 * MERCHANT_TOKEN.
 *
 * THIS IS THE LINE TO CHANGE when the app grows real users. Swap `none()` for the app's
 * own authenticator (`eve/channels/auth` ships httpBasic, jwtHmac, jwtEcdsa, oidc, and
 * vercelOidc) so sessions belong to someone. Leaving `none()` in place while adding
 * anything user-specific would make every session anonymous and shared.
 */
export default eveChannel({ auth: [none()] });
