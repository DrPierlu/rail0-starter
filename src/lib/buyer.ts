import { buildSiweMessage, Rail0ApiError, Rail0Client, type SigningPayload } from "@rail0/sdk";
import { agentWalletAddress, signAsAgent } from "./buyer-signer";
import { env } from "./env";
import type { CartLine, Order, OrderToken } from "./order-view";
import { packLines } from "./order-view";

/**
 * The BUYER's side of the checkout: three calls, and nothing kept between them.
 *
 * There is no signing stash any more, and the reason is worth stating because it also
 * explains the shape. The stash existed to carry the buyer's SIWE signature — and with
 * it their gateway JWT — from the browser to the code that used it, which meant this
 * server held a credential that can act as the buyer for 24 hours. It is gone because
 * the step boundaries moved: whoever holds a signature now uses it in the same request.
 *
 *   1. quote     — price the cart. Persists nothing, promises nothing.
 *   2. create    — SIWE message + signature + items, in ONE request: verify, exchange
 *                  for a session, create the payment carrying the lines in metadata.
 *   3. submit    — rail0 id + the EIP-3009 signature: sign the payment, hand it to the
 *                  merchant to escrow.
 *
 * A person buying is the browser doing 2 and 3 itself, with the session parked in an
 * httpOnly cookie between them (the page's JS never reads it). An agent buying is
 * `checkoutAsAgent` running all three inline, holding the session in a local variable
 * for the few hundred milliseconds it lives. Same three calls either way.
 */

// The statement POST /auth requires, verbatim. The gateway asserts it exactly
// (gateway#147), which is what stops a login proof from being replayed to register
// a wallet — so this is a protocol constant, not a UI string to reword.
const SIWE_LOGIN_STATEMENT = "Sign in to RAIL0";

/** What the storefront answers a quote with — the buyer's view of step 1. */
export interface CheckoutQuote {
  lines: CartLine[];
  /** Human decimal total (e.g. "7.15"). */
  total: string;
  /** The same total in the token's base units. */
  total_base: string;
  token: OrderToken;
  /** The merchant's wallet — the payee of the payment about to be created. */
  payee: string;
}

async function shopFetch<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  // Never .json() unconditionally: an unexpected non-JSON body (a bare 500, an
  // HTML error page from a proxy) used to surface as `SyntaxError: Unexpected
  // token 'I', "Internal S"... is not valid JSON` — masking the actual error.
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const error = (body as { error?: string } | undefined)?.error;
    throw new Error(
      error ?? `${path} failed with ${response.status}: ${text.slice(0, 200) || "empty body"}`,
    );
  }
  if (body === undefined) {
    throw new Error(`${path} answered ${response.status} with a non-JSON body`);
  }
  return body as T;
}

export function getShop(base: string) {
  return {
    products: (params?: { category?: string; search?: string }) => {
      const query = new URLSearchParams();
      if (params?.category) query.set("category", params.category);
      if (params?.search) query.set("search", params.search);
      const qs = query.size > 0 ? `?${query}` : "";
      return shopFetch<{
        merchant: { name: string; address: string };
        categories: string[];
        /** How many products matched, which can exceed the page returned. */
        total: number;
        products: unknown[];
      }>(base, `/api/shop/products${qs}`);
    },
    paymentMethods: () =>
      shopFetch<{
        payment_methods: {
          chain_id: number;
          chain_name?: string;
          symbol: string;
          address: string;
          decimals: number;
        }[];
      }>(base, "/api/shop/payment-methods"),
    /** Step 1. The merchant prices the cart; nothing is created anywhere. */
    quote: (items: { product_id: string; qty: number }[], chainId: number, tokenAddress: string) =>
      shopFetch<CheckoutQuote>(base, "/api/shop/quote", {
        method: "POST",
        body: JSON.stringify({ items, chain_id: chainId, token_address: tokenAddress }),
      }),
    /** An order, by the rail0 payment id that IS its identity. */
    order: (id: string) => shopFetch<{ order: Order }>(base, `/api/shop/orders/${id}`),
    // No `orders()` here on purpose: GET /api/shop/orders is the merchant's
    // order book, gated on the merchant token, and the buyer side holds no such
    // credential. A buyer lists the orders IT placed (agent/lib/orders.ts) and
    // reads each one by id.
  };
}

// A bare (unauthenticated) gateway client: enough for the SIWE nonce, and the
// carrier for auth.verify. One per call — no shared session state to corrupt.
function bareClient(): Rail0Client {
  return new Rail0Client({ baseUrl: env().RAIL0_GATEWAY_URL });
}

/**
 * The exact EIP-4361 text the buyer must sign, with a fresh nonce from the gateway.
 *
 * Delegates to the SDK's builder rather than assembling the text here. The
 * hand-rolled version had reverse-engineered the ruby siwe gem's layout — down to
 * the DOUBLE blank line a missing statement leaves — and that missing statement is
 * exactly what broke it: gateway#147 made proofs purpose-bound, so POST /auth now
 * requires the statement to be `Sign in to RAIL0` and refuses a statement-less
 * message with 422 siwe_purpose_mismatch. Signing the same bytes as every other
 * rail0 client is the point; owning a copy of the format never was.
 *
 * The message is the ONLY thing this step produces. It is not secret and nothing has
 * to remember it: it comes back with the signature in step 2, and the gateway — which
 * minted the nonce — is what decides whether the pair is good.
 */
export async function siweChallenge(buyerAddress: string): Promise<string> {
  const gateway = env().RAIL0_GATEWAY_URL;
  const { nonce } = await bareClient().auth.getNonce();
  return buildSiweMessage({
    // hostname, NOT host: the gateway's SIWE domain allow-list holds bare hosts
    // (Policy.siwe_domains defaults to "localhost"), and it also requires the message's
    // URI host to equal its domain — a URI host never carries the port, so a domain that
    // does fails both checks. Both raise SignerMismatch, which surfaces as "the signature
    // does not match the address": a configuration mismatch wearing a crypto error's
    // clothes. rail0-cli strips the port for the same reason (siweHost).
    domain: new URL(gateway).hostname,
    address: buyerAddress,
    uri: gateway,
    chainId: env().SIWE_CHAIN_ID,
    nonce,
    statement: SIWE_LOGIN_STATEMENT,
  });
}

export interface CreatedPayment {
  rail0_id: string;
  signing_payload: SigningPayload;
  /** The buyer's gateway session — the caller decides where it lives until step 3. */
  auth_token: string;
  /** ISO expiry of that session, for the cookie's lifetime. */
  expires_at: string;
  quote: CheckoutQuote;
}

/**
 * Checkout step 2 — one request: prove who the buyer is, and create their payment.
 *
 * The two used to be separate steps with the SIWE signature parked in between, and
 * that gap was the whole reason a stash existed. They are one call because they cannot
 * be anything else: the gateway requires the PAYER to be the caller, so the session the
 * signature buys is the only thing that can create this payment, and neither half is
 * useful without the other.
 *
 * The cart is re-quoted here rather than trusted from the client: the amount created is
 * the merchant's own price for the items, so a tampered total is not even expressible.
 * The lines then ride into the payment's `metadata` — the record of WHAT was bought,
 * which the gateway keeps and this app no longer has to.
 */
export async function createPayment(input: {
  base: string;
  items: { product_id: string; qty: number }[];
  chainId: number;
  tokenAddress: string;
  siweMessage: string;
  siweSignature: string;
  /**
   * The card's own checkout id, sent as the gateway's Idempotency-Key.
   *
   * Creating a payment is the ONE step of this flow with no natural guard — sign is
   * idempotent, authorize is documented as such, capture and void are gated on the
   * order's state — so it was the one that could run twice. The card holds the new
   * payment's id in component state, and a remount (hopping to /merchant mid-checkout,
   * a reload) loses it and starts over: without a key, "start over" meant a second
   * payment rather than the same one.
   *
   * The gateway binds the key to the request's TERMS, so a replay of these items
   * answers 200 with the existing payment and its signing payload, while the same key
   * against a changed cart is refused with 422 rather than silently signing something
   * else. Scoped to the payer, so it is not a handle anyone else can pull on.
   */
  idempotencyKey?: string;
}): Promise<CreatedPayment> {
  const quote = await getShop(input.base).quote(input.items, input.chainId, input.tokenAddress);

  const client = bareClient();
  const auth = await client.auth.verify(input.siweMessage, input.siweSignature);
  client.setAuthToken(auth.token);

  const payment = await client.payments.create(
    {
      chain_id: quote.token.chain_id,
      mode: "authorize",
      amount: quote.total,
      token: quote.token.address,
      // The address the GATEWAY recovered from the signature, not one the caller supplied:
      // the payer is whoever proved they hold the key, and nothing else gets a say.
      payer: auth.address,
      payee: quote.payee,
      description: describe(quote.lines),
      // The ORDER travels with the payment, because the payment IS the order now. The
      // gateway keeps `metadata` (jsonb, 4096 bytes) and that is where the lines live.
      //
      // Written by the PAYER, so it is a claim rather than a merchant record: the
      // storefront prices it against its own catalog before authorizing the escrow
      // (shop.ts, coversCatalogPrice).
      metadata: packLines(quote.lines),
    },
    input.idempotencyKey,
  );

  if (!payment.signing_payload) {
    throw new Error("gateway returned no signing payload for the new payment");
  }
  return {
    rail0_id: payment.rail0_id,
    signing_payload: payment.signing_payload,
    auth_token: auth.token,
    expires_at: auth.expiresAt,
    quote,
  };
}

/** A one-line description of the cart, for anyone reading the payment on the gateway. */
function describe(lines: readonly CartLine[]): string {
  const summary = lines.map((line) => `${line.qty}× ${line.name}`).join(", ");
  // The gateway's description column is not unbounded, and a 40-line cart would be a
  // wall of text in the admin either way. The metadata holds the authoritative list.
  return `rail0-starter: ${summary}`.slice(0, 200);
}

/**
 * The gateway refuses a second payer signature with 422 already_signed even when
 * the bytes are identical, so on a retry that code means "this step already ran",
 * not a failure. Only this one code: every other 422 (a signature that does not
 * recover to the payer, a payment past the point where a signature counts) is a
 * genuine error that must still surface.
 *
 * Exported for the unit test: the retry it makes safe cannot be reproduced
 * without a gateway, and `error` (not `code`, not `message`) being the field the
 * SDK exposes this on is exactly the detail worth pinning.
 */
export function isAlreadySigned(error: unknown): boolean {
  return error instanceof Rail0ApiError && error.error === "already_signed";
}

/**
 * Checkout step 3 — attach the payer's EIP-3009 signature and have the merchant
 * escrow it.
 *
 * IDEMPOTENT in both halves, and both were bugs once. The gateway is asked for the
 * payment's status rather than assuming this is the first attempt: `unsigned` is the
 * only status from which signing is still owed, and an already_signed race is treated
 * as "already signed, carry on". The merchant's authorize is idempotent for the same
 * reason (shop.ts), so a retry after a lost response reports the escrow rather than
 * refusing it.
 */
export async function submitPayment(input: {
  base: string;
  rail0Id: string;
  signature: string;
  authToken: string;
}): Promise<{ order: Order; rail0_id: string }> {
  const client = bareClient();
  client.setAuthToken(input.authToken);

  const payment = await client.payments.get(input.rail0Id);
  if (payment.status === "unsigned") {
    try {
      await client.payments.sign(input.rail0Id, { signature: input.signature });
    } catch (error) {
      // A concurrent retry can sign between the read above and this call.
      if (!isAlreadySigned(error)) throw error;
    }
  }

  // Over HTTP, not by calling shop.ts directly: the storefront is a separate deployable
  // from the buyer side, and this is the boundary between them. It is also the only
  // place the merchant's own key signs, which is exactly where that split belongs.
  const { order } = await shopFetch<{ order: Order }>(
    input.base,
    `/api/shop/payments/${input.rail0Id}/authorize`,
    { method: "POST" },
  );
  return { order, rail0_id: input.rail0Id };
}

/**
 * The whole checkout, start to finish, signed by the AGENT'S OWN WALLET.
 *
 * The same three calls as the browser flow — it calls them rather than reimplementing
 * them, so every behaviour they carry (the merchant-priced amount, the idempotent sign,
 * the idempotent authorize) applies here unchanged. The only difference is who produces
 * the two signatures and when: the browser path parks a card in the chat and waits for a
 * human, and this one signs inline and keeps going.
 *
 * The buyer session never leaves this function — no cookie, no store, no stash. That is
 * what the rewrite bought: the autonomous path holds the credential for the length of
 * one function call, and the browser path holds it in the buyer's own cookie jar.
 *
 * The caller decides WHETHER to run this — that decision is a spending decision (see
 * lib/agent-budget), not a mechanical one, and it belongs with the tool that has the
 * cart and the approval policy.
 */
export async function checkoutAsAgent(
  base: string,
  items: { product_id: string; qty: number }[],
  chainId: number,
  tokenAddress: string,
): Promise<{ order: Order; rail0_id: string }> {
  const address = agentWalletAddress();
  if (!address) throw new Error("no agent wallet configured");

  const siweMessage = await siweChallenge(address);
  const created = await createPayment({
    base,
    items,
    chainId,
    tokenAddress,
    siweMessage,
    siweSignature: signAsAgent({ kind: "message", message: siweMessage }),
  });

  return await submitPayment({
    base,
    rail0Id: created.rail0_id,
    signature: signAsAgent({ kind: "typed_data", payload: created.signing_payload }),
    authToken: created.auth_token,
  });
}
