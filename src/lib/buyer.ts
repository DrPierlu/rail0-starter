import { buildSiweMessage, Rail0ApiError, Rail0Client, type SigningPayload } from "@rail0/sdk";
import { clearSigning, getSigning, putSigning } from "./checkout-signing";
import { env } from "./env";
import type { Order } from "./store";

// Buyer-side payment flow — KEYLESS on this branch: the server never holds the
// buyer's private key. Every buyer signature (the SIWE login and the EIP-3009
// payment authorization) is produced in the browser — MetaMask or a pasted key
// that stays client-side — and handed to the storefront out-of-band (the
// signature stash in the store), never through the model's context where a
// mangled hex digit would burn the payment. The checkout is therefore three
// tool steps, each pausing for the browser to sign.

// The statement POST /auth requires, verbatim. The gateway asserts it exactly
// (gateway#147), which is what stops a login proof from being replayed to register
// a wallet — so this is a protocol constant, not a UI string to reword.
const SIWE_LOGIN_STATEMENT = "Sign in to RAIL0";

interface PaymentInstructions {
  payee: string;
  chain_id: number;
  token: string;
  /** Human decimal amount (e.g. "5.20") — what the gateway's create expects. */
  amount: string;
  /** Same amount in token base units, informative only. */
  amount_base: string;
  mode: string;
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
  return new Rail0Client({ baseUrl: env().GATEWAY_URL });
}

/**
 * The exact EIP-4361 text the browser must sign. Built server-side so the nonce
 * comes straight from the gateway.
 *
 * Delegates to the SDK's builder rather than assembling the text here. The
 * hand-rolled version had reverse-engineered the ruby siwe gem's layout — down to
 * the DOUBLE blank line a missing statement leaves — and that missing statement is
 * exactly what broke it: gateway#147 made proofs purpose-bound, so POST /auth now
 * requires the statement to be `Sign in to RAIL0` and refuses a statement-less
 * message with 422 siwe_purpose_mismatch. Signing the same bytes as every other
 * rail0 client is the point; owning a copy of the format never was.
 */
function siweMessage(domain: string, uri: string, address: string, nonce: string): string {
  return buildSiweMessage({
    domain,
    address,
    uri,
    chainId: env().SIWE_CHAIN_ID,
    nonce,
    statement: SIWE_LOGIN_STATEMENT,
  });
}

/**
 * Checkout step 1 — create the order and the SIWE challenge.
 *
 * `buyerAddress` comes from the connected browser wallet (checksummed there;
 * the gateway's SIWE parser rejects a lowercase address). Returns the exact
 * message the browser must personal_sign; everything the later steps need is
 * parked in the signing stash, keyed by the order.
 */
export async function beginCheckout(
  base: string,
  items: { product_id: string; qty: number }[],
  chainId: number,
  tokenAddress: string,
  buyerAddress: string,
): Promise<{ order: Order; siwe_message: string; instructions: PaymentInstructions }> {
  const { order, payment_instructions } = await shopFetch<{
    order: Order;
    payment_instructions: PaymentInstructions;
  }>(base, "/api/shop/orders", {
    method: "POST",
    body: JSON.stringify({ items, chain_id: chainId, token_address: tokenAddress }),
  });

  const gateway = env().GATEWAY_URL;
  const { nonce } = await bareClient().auth.getNonce();
  // hostname, NOT host: the gateway's SIWE domain allow-list holds bare hosts
  // (Policy.siwe_domains defaults to "localhost"), and it also requires the message's
  // URI host to equal its domain — a URI host never carries the port, so a domain that
  // does fails both checks. Both raise SignerMismatch, which surfaces as "the signature
  // does not match the address": a configuration mismatch wearing a crypto error's
  // clothes. rail0-cli strips the port for the same reason (siweHost).
  const message = siweMessage(new URL(gateway).hostname, gateway, buyerAddress, nonce);

  await putSigning(order.id, { address: buyerAddress, siwe_message: message });
  return { order, siwe_message: message, instructions: payment_instructions };
}

/**
 * Checkout step 2 — trade the browser's SIWE signature for a buyer session and
 * create the rail0 payment as that payer. Returns the EIP-712 payload the
 * browser must sign next (eth_signTypedData_v4 / the SDK's signPayment).
 */
export async function createPaymentForOrder(
  base: string,
  orderId: string,
): Promise<{ rail0_id: string; signing_payload: SigningPayload }> {
  const entry = await getSigning(orderId);
  if (!entry) throw new Error(`no checkout in progress for order ${orderId}`);
  if (!entry.siwe_signature) {
    throw new Error("the sign-in signature has not arrived yet — ask the user to sign first");
  }

  const order = await shopFetch<{ order: Order }>(base, `/api/shop/orders/${orderId}`).then(
    (r) => r.order,
  );

  const client = bareClient();
  // The SIWE nonce is SINGLE-USE, so auth.verify can only ever run once per checkout.
  // Reuse the token from a previous attempt when there is one: this tool is re-run
  // whenever anything after it failed (a network blip at payments.create, the browser
  // losing the dev server, the agent retrying the step), and re-verifying then burns
  // the flow with 422 nonce_used — "Sign-in nonce already used" — which reads as a
  // security complaint rather than "this step already ran".
  let authToken = entry.auth_token;
  if (!authToken) {
    const auth = await client.auth.verify(entry.siwe_message, entry.siwe_signature);
    authToken = auth.token;
    // Persisted BEFORE anything else can fail. It used to be stored only after
    // payments.create succeeded, so a failure in between lost the token AND left the
    // nonce spent: the order could never be paid, by any retry, and the only way out
    // was a brand-new checkout.
    await putSigning(orderId, { auth_token: authToken });
  }
  client.setAuthToken(authToken);

  const payment = await client.payments.create({
    chain_id: order.token.chain_id,
    mode: "authorize",
    amount: order.total,
    token: order.token.address,
    payer: entry.address,
    payee: (await shopFetch<{ merchant: { address: string } }>(base, "/api/shop/products")).merchant
      .address,
    description: `rail0-starter order ${orderId}`,
    metadata: { order_id: orderId },
  });

  if (!payment.signing_payload) {
    throw new Error("gateway returned no signing payload for the new payment");
  }
  await putSigning(orderId, { rail0_id: payment.rail0_id });
  return { rail0_id: payment.rail0_id, signing_payload: payment.signing_payload };
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
 * Checkout step 3 — attach the browser's EIP-3009 signature and hand the
 * signed payment to the storefront, which verifies it and broadcasts the
 * authorize. Tolerates a replay: if the order already moved past
 * awaiting_payment, it just reports the current state.
 *
 * IDEMPOTENT, like step 2's auth-token reuse, and for a worse failure. `sign`
 * used to run unconditionally: if it succeeded and the attach POST after it did
 * not (a network blip, the dev server restarting, the agent retrying the step),
 * the order stayed `awaiting_payment` — so the early return below never fired —
 * and every retry re-signed, took 422 already_signed, and died BEFORE the
 * attach. The payment was signed, the order was stuck for good, and no retry
 * could ever move it. So the payment's own status decides whether to sign, and
 * an already_signed race is treated as "already signed, carry on".
 */
export async function submitSignedPayment(
  base: string,
  orderId: string,
): Promise<{ order: Order; rail0_id: string }> {
  const entry = await getSigning(orderId);
  if (!entry?.rail0_id) throw new Error(`no payment created yet for order ${orderId}`);
  if (!entry.eip3009_signature) {
    throw new Error("the payment signature has not arrived yet — ask the user to sign first");
  }

  // Over HTTP, not the merchant's store directly: the storefront is a separate
  // deployable, so a local read here saw an empty store (and therefore no order)
  // in exactly the split this file's boundary exists for. The GET also refreshes
  // the order from the gateway, so what it answers is live.
  const current = await shopFetch<{ order: Order }>(base, `/api/shop/orders/${orderId}`).then(
    (r) => r.order,
  );
  if (current.state !== "awaiting_payment") {
    return { order: current, rail0_id: entry.rail0_id };
  }

  const client = bareClient();
  if (!entry.auth_token) throw new Error("buyer session expired — restart the checkout");
  client.setAuthToken(entry.auth_token);

  // The gateway is the authority on whether the signature landed — not the local
  // stash, which the split deployment above makes unreliable. `unsigned` is the
  // only status from which signing is still owed; anything later (signed,
  // authorized, …) means it happened, and the attach is what is missing.
  const payment = await client.payments.get(entry.rail0_id);
  if (payment.status === "unsigned") {
    try {
      await client.payments.sign(entry.rail0_id, { signature: entry.eip3009_signature });
    } catch (error) {
      // A concurrent retry can sign between the read above and this call.
      if (!isAlreadySigned(error)) throw error;
    }
  }

  const attached = await shopFetch<{ order: Order }>(base, `/api/shop/orders/${orderId}/payment`, {
    method: "POST",
    body: JSON.stringify({ rail0_id: entry.rail0_id }),
  });

  await clearSigning(orderId);
  return { order: attached.order, rail0_id: entry.rail0_id };
}
