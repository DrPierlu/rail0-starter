import { type AuthFn, localDev } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import { BUYER_COOKIE, hasBuyerSession } from "../../src/lib/buyer-auth";

/**
 * Who may talk to the agent.
 *
 * This file exists because eve's default is FAIL-CLOSED — without it the registered
 * auth is `[vercelOidc(), localDev()]`, which wants a bearer token a browser does not
 * carry, so the chat worked on localhost and answered 401 on Vercel.
 *
 * It used to answer `none()`: every request accepted, anonymously. That was defensible
 * while the buyer paid from their own wallet — whoever arrived spent their own money,
 * and there was no account to authenticate. It stopped being defensible when a
 * deployment could hold a wallet of its own (BUYER_PRIVATE_KEY): talking to the agent
 * then IS spending, and the per-order approval that gates it is asked and answered over
 * THIS channel. Left open, the gate on autonomous spending was answerable by anyone
 * with the URL.
 *
 * Order matters. `localDev()` first, so `eve dev` needs no token — it authenticates on
 * a property of the DEPLOYMENT (EVE_DEV/vercel dev), never on a request header, so no
 * inbound Host can forge its way in. Anywhere else it returns null and the walk falls
 * through to the cookie, which is the only way in on a real deployment.
 *
 * Still one shared secret rather than accounts: this is one operator's own instance.
 * When it grows real users, this is again the line to change — swap the cookie check
 * for the app's own authenticator (`eve/channels/auth` ships httpBasic, jwtHmac,
 * jwtEcdsa, oidc and vercelOidc) so sessions belong to someone.
 */
const buyerCookie: AuthFn<Request> = (request) => {
  if (!hasBuyerSession(request.headers.get("cookie"))) return null;
  // A principal, not a person: the secret proves someone is allowed in, not who. Naming
  // that honestly here beats inventing an identity the app cannot substantiate.
  return {
    attributes: {},
    authenticator: `rail0-starter:${BUYER_COOKIE}`,
    issuer: "rail0-starter",
    principalId: "operator",
    principalType: "user",
  };
};

export default eveChannel({ auth: [localDev(), buyerCookie] });
