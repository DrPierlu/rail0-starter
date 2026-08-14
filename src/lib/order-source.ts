import { type Order, type OrderToken, orderFrom, type PaymentLike } from "./order-view";
import { addressFor, clientFor } from "./rail0";
import { listPaymentMethods } from "./shop";

/**
 * Reading orders from the gateway — the replacement for the order store.
 *
 * The store's job was to remember orders; the gateway already does, because an order is
 * a payment. These are the two reads the app needs (one order, and the merchant's
 * book), projected through order-view.
 *
 * Not wired yet: the app still reads the store, and the switch also changes what an
 * order id IS — today a local 8-hex, here the rail0_id. That is one change, not a
 * gradual one, so it lands in a single step with these already in place and tested.
 */

/**
 * The token a payment was made in, from the merchant's accepted methods.
 *
 * A payment carries its chain and token ADDRESS but not the symbol or decimals, and
 * both are needed to show an amount — decimals to compute it at all. The accepted
 * methods are the merchant's own list, already fetched from the gateway for the
 * storefront, so this needs no new source.
 *
 * A payment in a token the merchant no longer accepts still has to render: falling back
 * to 6 decimals would print a wrong number, so the token is returned undefined and the
 * caller decides. Every stablecoin here is 6, which is exactly why a silent default
 * would go unnoticed until the one that is not.
 */
export async function tokenFor(
  chainId: number | undefined,
  address: string | undefined,
): Promise<OrderToken | undefined> {
  if (!address) return undefined;
  const methods = await listPaymentMethods();
  const wanted = address.toLowerCase();

  // With a chain id — the detail read has one — this is exact.
  if (chainId !== undefined) {
    return methods.find((m) => m.chain_id === chainId && m.address.toLowerCase() === wanted);
  }

  // Without one, match on the address alone. The LIST entity does not expose chain_id
  // (only the single-payment view does), and a token address is per-chain, so this is
  // the only key available there. Accepted only when it resolves to exactly one method:
  // an address the merchant accepts on two chains is ambiguous, and rendering an amount
  // with the wrong decimals is worse than not rendering the row. The real fix is on the
  // gateway — chain_id on the list entity — not a guess here.
  const matches = methods.filter((m) => m.address.toLowerCase() === wanted);
  return matches.length === 1 ? matches[0] : undefined;
}

/** One order, by its rail0 payment id. Undefined when the gateway has no such payment. */
export async function readOrder(rail0Id: string): Promise<Order | undefined> {
  const seller = await clientFor("seller");
  const payment = await seller.payments.get(rail0Id).catch(() => undefined);
  if (!payment) return undefined;
  const token = await tokenFor(payment.chain_id, payment.token);
  return token ? orderFrom(payment as PaymentLike, token) : undefined;
}

/**
 * The merchant's order book: every payment where it is the payee, newest first.
 *
 * `GET /payments` is already scoped to the authenticated wallet, so this is the whole
 * gate — there is no order list to keep in sync, and no way for it to show another
 * merchant's orders because the gateway will not answer with them.
 *
 * The list endpoint returns payments without their transactions, so an order's state
 * here comes from the payment status alone: a capture being mined reads as `in_escrow`
 * rather than `capturing` until it confirms. The detail read has the transactions and
 * is precise; a list that fetched each one would be N+1 requests per poll.
 */
export async function readOrders(limit = 50): Promise<Order[]> {
  const seller = await clientFor("seller");
  const page = await seller.payments.list({
    payee: addressFor("seller"),
    sort: "-created_at",
    per_page: limit,
  });

  const orders: Order[] = [];
  for (const payment of page.data ?? []) {
    const token = await tokenFor(undefined, payment.token);
    if (token) orders.push(orderFrom(payment as PaymentLike, token));
  }
  return orders;
}
