import { signPayment } from "@rail0/sdk";
import { env } from "./env";
import { addressFor, clientFor, packSignature } from "./rail0";
import type { Order } from "./store";

// Buyer-side payment flow. The agent talks to the storefront over HTTP (the
// buyer/seller boundary stays a real network boundary), but signs payments
// locally with the buyer's own key — the seller never sees it.

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

async function shopFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${env().APP_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `${path} failed with ${response.status}`);
  }
  return body;
}

export function getShop() {
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
      }>(`/api/shop/products${qs}`);
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
      }>("/api/shop/payment-methods"),
    order: (id: string) => shopFetch<{ order: Order }>(`/api/shop/orders/${id}`),
    orders: () => shopFetch<{ orders: Order[] }>("/api/shop/orders"),
  };
}

/**
 * Place and pay for an order in one buyer-side flow:
 *  1. create the order on the storefront (gets total + payment instructions)
 *  2. create the rail0 payment as the payer (mode: authorize — escrow)
 *  3. sign the EIP-3009 payload locally and store the signature
 *  4. hand the signed payment back to the storefront, which moves it to escrow
 *
 * Returns the order in `authorizing` state; the escrow confirms asynchronously
 * (poll order_status).
 */
export async function placeAndPayOrder(
  items: { product_id: string; qty: number }[],
  chainId: number,
  tokenAddress: string,
): Promise<{ order: Order; rail0_id: string }> {
  const { order, payment_instructions } = await shopFetch<{
    order: Order;
    payment_instructions: PaymentInstructions;
  }>("/api/shop/orders", {
    method: "POST",
    body: JSON.stringify({
      items,
      chain_id: chainId,
      token_address: tokenAddress,
    }),
  });

  const buyer = await clientFor("buyer");
  const payment = await buyer.payments.create({
    chain_id: payment_instructions.chain_id,
    mode: "authorize",
    amount: payment_instructions.amount,
    token: payment_instructions.token,
    payer: addressFor("buyer"),
    payee: payment_instructions.payee,
    description: `rail0-starter order ${order.id}`,
    metadata: { order_id: order.id },
  });

  const signature = signPayment(env().BUYER_PRIVATE_KEY as `0x${string}`, payment);
  await buyer.payments.sign(payment.rail0_id, {
    signature: packSignature(signature),
  });

  const attached = await shopFetch<{ order: Order }>(`/api/shop/orders/${order.id}/payment`, {
    method: "POST",
    body: JSON.stringify({ rail0_id: payment.rail0_id }),
  });

  return { order: attached.order, rail0_id: payment.rail0_id };
}
