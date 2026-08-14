import { formatAmount, signTransaction } from "@rail0/sdk";
import { env } from "./env";
import {
  type Order,
  type OrderToken,
  orderFrom,
  type PaymentLike,
  unpackLines,
} from "./order-view";
import { coversCatalogPrice, type QuotedOrder, QuoteError, quote } from "./quote";
import { addressFor, clientFor } from "./rail0";

/**
 * The MERCHANT's side of the rail0 gateway: what it accepts, what it is owed, and the
 * three transactions it signs (authorize, capture, void).
 *
 * There is no order store behind any of this. An order IS a payment, so every read here
 * is a gateway read projected through order-view, and nothing is written back — the two
 * copies that used to disagree are now one. What the merchant used to REMEMBER (the
 * lines, the total it quoted) it recomputes from its own catalog instead, which is the
 * only copy that cannot drift and the only one an attacker cannot write.
 */

export interface PaymentMethod {
  chain_id: number;
  chain_name?: string;
  symbol: string;
  address: string;
  decimals: number;
}

/**
 * The merchant's accepted chain/token pairs. Read from the gateway's public
 * buyer-discovery endpoint (GET /payment_methods?address=…) — never hardcoded:
 * what the merchant accepts is configured on the gateway, not in this repo.
 */
export async function listPaymentMethods(): Promise<PaymentMethod[]> {
  const seller = await clientFor("seller");
  const [wallets, chains] = await Promise.all([
    seller.paymentMethods.list({ address: addressFor("seller") }),
    seller.chains.list(),
  ]);
  const chainNames = new Map(chains.map((c) => [c.chain_id ?? 0, c.name ?? ""]));
  const methods: PaymentMethod[] = [];
  for (const wallet of wallets) {
    for (const holding of wallet.tokens ?? []) {
      const token = holding.token;
      if (!holding.active || !token?.active) continue;
      if (
        token.chain_id === undefined ||
        token.address === undefined ||
        token.symbol === undefined ||
        token.decimals === undefined
      )
        continue;
      methods.push({
        chain_id: token.chain_id,
        chain_name: chainNames.get(token.chain_id),
        symbol: token.symbol,
        address: token.address,
        decimals: token.decimals,
      });
    }
  }
  return methods;
}

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

/**
 * Price a cart in one of the merchant's accepted tokens — the whole of step 1.
 *
 * It persists nothing, and that is the point: the quote is a statement of what the
 * merchant sells for right now, not a promise it has to remember. What binds the two
 * sides is the payment the buyer then creates, and this same function re-prices its
 * claim before the escrow is authorized (coversCatalogPrice, below).
 */
export async function quoteFor(
  items: readonly { product_id: string; qty: number }[],
  chainId: number,
  tokenAddress: string,
): Promise<QuotedOrder & { token: OrderToken; payee: string }> {
  const token = await tokenFor(chainId, tokenAddress);
  if (!token) throw new ShopError(422, "merchant does not accept this chain/token pair");
  try {
    return { ...quote(items, token.decimals), token, payee: addressFor("seller") };
  } catch (error) {
    if (error instanceof QuoteError) throw new ShopError(422, error.message);
    throw error;
  }
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

  // One methods read for the whole page, not one per payment: tokenFor would otherwise
  // re-fetch the merchant's wallets for every row of the order book.
  const methods = await listPaymentMethods();
  const orders: Order[] = [];
  for (const payment of page.data ?? []) {
    const wanted = payment.token?.toLowerCase();
    const matches = methods.filter((m) => m.address.toLowerCase() === wanted);
    if (matches.length === 1) orders.push(orderFrom(payment as PaymentLike, matches[0]));
  }
  return orders;
}

/**
 * Escrow a buyer's signed payment — the merchant's half of checkout step 3.
 *
 * Everything it checks, it checks against the GATEWAY and its own CATALOG, because
 * there is no longer a stored order to compare with. The request body carries one
 * thing, a payment id, and a payment id is not a claim about anything: what the payment
 * is for, who it pays and how much are all read from the gateway.
 *
 * The line that guards the money is `coversCatalogPrice`. The items ride in the
 * payment's metadata and are written by the PAYER, so they are a claim — "I am paying
 * for these" — and the merchant prices that claim itself before locking anything in
 * escrow. A claim it cannot price (unknown product, no items at all) is refused: an
 * order the merchant cannot fulfil deliberately is one it must not fulfil at all.
 *
 * IDEMPOTENT. A payment already past `signed` has been authorized by an earlier call
 * whose response was lost, so this reports the current state rather than refusing — the
 * buyer's funds are moving and a 422 here would read as "your payment failed".
 */
export async function authorizePayment(rail0Id: string): Promise<Order> {
  const seller = await clientFor("seller");
  const payment = await seller.payments.get(rail0Id);

  if (payment.payee.toLowerCase() !== addressFor("seller").toLowerCase()) {
    throw new ShopError(422, "payment payee is not this merchant");
  }
  if (payment.mode !== "authorize") {
    throw new ShopError(422, "payment mode must be authorize (escrow)");
  }

  const token = await tokenFor(payment.chain_id, payment.token);
  if (!token) throw new ShopError(422, "merchant does not accept this chain/token pair");

  const claimed = unpackLines(payment.metadata);
  if (!coversCatalogPrice(claimed, payment.amount, token.decimals)) {
    // Human decimals, not naked base units: this message travels up to the chat, and
    // "2600000 does not cover 2610000" is unreadable exactly where the numbers matter
    // most. Raw base units stay as a debugging adjunct.
    const human = `${formatAmount(payment.amount, token.decimals)} ${token.symbol}`;
    throw new ShopError(
      422,
      `payment of ${human} does not cover the catalog price of the items it claims ` +
        `(base units: ${payment.amount})`,
    );
  }

  if (payment.status === "unsigned") {
    throw new ShopError(422, "the payer has not signed this payment yet");
  }
  if (payment.status !== "signed") {
    return orderFrom(payment as PaymentLike, token);
  }

  const prep = await seller.payments.authorizePrepare(rail0Id);
  if (!prep.unsigned_transaction) {
    throw new ShopError(502, "gateway returned no unsigned authorize transaction");
  }
  await seller.payments.authorize(rail0Id, {
    signed_transaction: signTransaction(
      prep.unsigned_transaction,
      env().SELLER_PRIVATE_KEY as `0x${string}`,
    ),
  });

  return await reread(rail0Id, payment as PaymentLike, token);
}

/** Capture the full escrowed amount — the merchant settles after fulfilment. */
export async function captureOrder(rail0Id: string): Promise<Order> {
  const order = await requireOrderInState(rail0Id, "in_escrow");
  const seller = await clientFor("seller");
  // capture/refund prepare, like create, take the HUMAN decimal amount.
  const prep = await seller.payments.capturePrepare(rail0Id, order.total);
  if (!prep.unsigned_transaction) {
    throw new ShopError(502, "gateway returned no unsigned capture transaction");
  }
  await seller.payments.capture(rail0Id, {
    signed_transaction: signTransaction(
      prep.unsigned_transaction,
      env().SELLER_PRIVATE_KEY as `0x${string}`,
    ),
  });
  return await reread(rail0Id, undefined, order.token);
}

/** Void the authorization — cancels the order and returns the escrow to the buyer. */
export async function voidOrder(rail0Id: string): Promise<Order> {
  const order = await requireOrderInState(rail0Id, "in_escrow");
  const seller = await clientFor("seller");
  const prep = await seller.payments.voidPrepare(rail0Id);
  if (!prep.unsigned_transaction) {
    throw new ShopError(502, "gateway returned no unsigned void transaction");
  }
  await seller.payments.void(rail0Id, {
    signed_transaction: signTransaction(
      prep.unsigned_transaction,
      env().SELLER_PRIVATE_KEY as `0x${string}`,
    ),
  });
  return await reread(rail0Id, undefined, order.token);
}

/**
 * The order as it stands after a broadcast.
 *
 * A re-read rather than a locally patched copy: the gateway has just recorded a
 * transaction row, and `stateOf` reads exactly that row to say `authorizing` /
 * `capturing` / `voiding`. Synthesising the state here would be a second implementation
 * of the projection, which is the divergence this whole rewrite removes.
 *
 * `fallback` covers the read failing right after a broadcast that DID land: reporting
 * the pre-broadcast payment is better than raising, because the operation succeeded and
 * the next poll will show it.
 */
async function reread(
  rail0Id: string,
  fallback: PaymentLike | undefined,
  token: OrderToken,
): Promise<Order> {
  const order = await readOrder(rail0Id);
  if (order) return order;
  if (fallback) return orderFrom(fallback, token);
  throw new ShopError(502, "the gateway did not answer for the payment just broadcast");
}

async function requireOrderInState(rail0Id: string, state: Order["state"]): Promise<Order> {
  const order = await readOrder(rail0Id);
  if (!order) throw new ShopError(404, "order not found");
  if (order.state !== state) {
    throw new ShopError(409, `order is ${order.state}, expected ${state}`);
  }
  return order;
}

export class ShopError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
