import { Rail0Client, type SigningPayload } from "@rail0/sdk";
import { env } from "./env";
import { clearSigning, getOrder, getSigning, type Order, putSigning } from "./store";

// Buyer-side payment flow — KEYLESS on this branch: the server never holds the
// buyer's private key. Every buyer signature (the SIWE login and the EIP-3009
// payment authorization) is produced in the browser — MetaMask or a pasted key
// that stays client-side — and handed to the storefront out-of-band (the
// signature stash in the store), never through the model's context where a
// mangled hex digit would burn the payment. The checkout is therefore three
// tool steps, each pausing for the browser to sign.

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
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `${path} failed with ${response.status}`);
  }
  return body;
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
    orders: () => shopFetch<{ orders: Order[] }>(base, "/api/shop/orders"),
  };
}

// A bare (unauthenticated) gateway client: enough for the SIWE nonce, and the
// carrier for auth.verify. One per call — no shared session state to corrupt.
function bareClient(): Rail0Client {
  return new Rail0Client({ baseUrl: env().GATEWAY_URL });
}

/**
 * The exact EIP-4361 text the browser must sign. Built server-side so the
 * nonce comes straight from the gateway, in the one layout the gateway's SIWE
 * parser accepts: checksummed address, and — with no statement — a DOUBLE
 * blank line between the address and the URI field (verified against the
 * ruby siwe gem; a single blank line is rejected as invalid input).
 */
function siweMessage(domain: string, uri: string, address: string, nonce: string): string {
  return (
    `${domain} wants you to sign in with your Ethereum account:\n${address}\n` +
    `\n\nURI: ${uri}\nVersion: 1\nChain ID: ${env().SIWE_CHAIN_ID}\n` +
    `Nonce: ${nonce}\nIssued At: ${new Date().toISOString()}`
  );
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
  const message = siweMessage(new URL(gateway).host, gateway, buyerAddress, nonce);

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
  const auth = await client.auth.verify(entry.siwe_message, entry.siwe_signature);
  client.setAuthToken(auth.token);

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
  await putSigning(orderId, { auth_token: auth.token, rail0_id: payment.rail0_id });
  return { rail0_id: payment.rail0_id, signing_payload: payment.signing_payload };
}

/**
 * Checkout step 3 — attach the browser's EIP-3009 signature and hand the
 * signed payment to the storefront, which verifies it and broadcasts the
 * authorize. Tolerates a replay: if the order already moved past
 * awaiting_payment, it just reports the current state.
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

  const current = await getOrder(orderId);
  if (current && current.state !== "awaiting_payment") {
    return { order: current, rail0_id: entry.rail0_id };
  }

  const client = bareClient();
  if (!entry.auth_token) throw new Error("buyer session expired — restart the checkout");
  client.setAuthToken(entry.auth_token);
  await client.payments.sign(entry.rail0_id, { signature: entry.eip3009_signature });

  const attached = await shopFetch<{ order: Order }>(base, `/api/shop/orders/${orderId}/payment`, {
    method: "POST",
    body: JSON.stringify({ rail0_id: entry.rail0_id }),
  });

  await clearSigning(orderId);
  return { order: attached.order, rail0_id: entry.rail0_id };
}
