import { formatAmount, signTransaction } from "@rail0/sdk";
import { env } from "./env";
import { logEvent, short, startOp } from "./log";
import {
  exactAmount,
  type Order,
  type OrderToken,
  orderFrom,
  type PaymentLike,
  type PriceCheck,
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
  const merchant = await clientFor("merchant");
  const [wallets, chains] = await Promise.all([
    merchant.paymentMethods.list({ address: addressFor("merchant") }),
    merchant.chains.list(),
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
 * Every token the gateway knows, by `chainId:address`.
 *
 * The catalog, NOT the merchant's accepted methods. `GET /tokens` returns retired
 * tokens too, and says why: a payment references its token address forever, so a
 * historical order has to stay resolvable long after the merchant stops offering that
 * token. Resolving from the accepted methods instead made "the merchant disabled this
 * token" indistinguishable from "this token does not exist" — and the order vanished.
 *
 * One read, shared by the single-order and the order-book paths, so neither pays per row.
 */
async function tokenCatalog(): Promise<Map<string, OrderToken>> {
  const merchant = await clientFor("merchant");
  const [tokens, chains] = await Promise.all([merchant.tokens.list(), merchant.chains.list()]);
  const chainNames = new Map(chains.map((c) => [c.chain_id ?? 0, c.name ?? ""]));
  const byKey = new Map<string, OrderToken>();
  for (const token of tokens) {
    if (token.chain_id === undefined || !token.address || !token.symbol) continue;
    if (token.decimals === undefined) continue;
    byKey.set(tokenKey(token.chain_id, token.address), {
      chain_id: token.chain_id,
      chain_name: chainNames.get(token.chain_id),
      symbol: token.symbol,
      address: token.address,
      decimals: token.decimals,
    });
  }
  return byKey;
}

/** The catalog key. Lowercased, because a payment stores whatever case it was given. */
function tokenKey(chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`;
}

/**
 * The token a payment was made in.
 *
 * A payment carries its chain and token ADDRESS but not the symbol or decimals, and
 * both are needed to show an amount — decimals to compute it at all. `(chain_id,
 * address)` is the exact key: an address alone identifies a token only within one
 * chain, which is why the gateway now puts `chain_id` on list rows as well as on the
 * detail (rail0-gateway#193). Before that this had to match on the address alone and
 * accept the result only when it was unique, so an address the merchant took on two
 * chains resolved to nothing.
 *
 * Undefined only when the CATALOG has no such token, which is a configuration fault
 * rather than a normal state. Falling back to 6 decimals would print a wrong number:
 * every stablecoin here is 6, which is exactly why a silent default would go unnoticed
 * until the one that is not.
 */
export async function tokenFor(
  chainId: number | undefined,
  address: string | undefined,
): Promise<OrderToken | undefined> {
  if (!address || chainId === undefined) return undefined;
  return (await tokenCatalog()).get(tokenKey(chainId, address));
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
    return { ...quote(items, token.decimals), token, payee: addressFor("merchant") };
  } catch (error) {
    if (error instanceof QuoteError) throw new ShopError(422, error.message);
    throw error;
  }
}

/** One order, by its rail0 payment id. Undefined when the gateway has no such payment. */
export async function readOrder(rail0Id: string): Promise<Order | undefined> {
  const merchant = await clientFor("merchant");
  const payment = await merchant.payments.get(rail0Id).catch(() => undefined);
  if (!payment) return undefined;
  const token = await tokenFor(payment.chain_id, payment.token);
  if (!token) return undefined;
  const order = orderFrom(payment as PaymentLike, token);
  return { ...order, price_check: priceCheckFor(order) };
}

/**
 * The merchant's re-pricing of what an order CLAIMS to be for (#2).
 *
 * The lines come from the payment's metadata, written by the payer, so this is the
 * merchant pricing a claim against its own catalog — the same computation
 * `authorizePayment` gates on, surfaced so the dashboard can show it happening. Cheap and
 * local: no gateway call, just the catalog and the arithmetic.
 *
 * Computed for every order, shown for almost none: `priceCheckNote` decides where the
 * verdict still means something, and after the escrow exists it does not.
 */
function priceCheckFor(order: Order): PriceCheck {
  const claimed = order.lines.map((line) => ({ product_id: line.product_id, qty: line.qty }));
  try {
    const priced = quote(claimed, order.token.decimals);
    return {
      catalog_total: priced.total,
      covered: coversCatalogPrice(claimed, order.total_base, order.token.decimals),
    };
  } catch (error) {
    // An unknown product or an empty claim does not price — and an order the merchant
    // cannot price is one it must not fulfil, which is why this is not "covered". The
    // reason travels with the verdict: "unknown product: pouch" is usually a catalog
    // edit, and reading it as a refused payment is how this line got misleading.
    return {
      catalog_total: "—",
      covered: false,
      unpriceable: true,
      reason: error instanceof QuoteError ? error.message : "could not be priced",
    };
  }
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
 *
 * `total` is the gateway's own count (from `x-total-count`), not the length of what
 * comes back — the merchant's book is paged, and a page that returns ten says nothing
 * about whether there are eleven. It is also why the count is taken before the filter
 * below drops anything: what the dashboard asks is "is there more to fetch", and the
 * answer belongs to the gateway.
 */
export async function readOrders(
  limit = 50,
): Promise<{ orders: Order[]; total: number; unresolved: number }> {
  const merchant = await clientFor("merchant");
  const page = await merchant.payments.list({
    payee: addressFor("merchant"),
    sort: "-created_at",
    per_page: limit,
  });

  // One catalog read for the whole page, not one per payment: tokenFor would otherwise
  // re-fetch it for every row of the order book.
  const catalog = await tokenCatalog();
  const orders: Order[] = [];
  let unresolved = 0;
  for (const payment of page.data ?? []) {
    const token =
      payment.chain_id === undefined || !payment.token
        ? undefined
        : catalog.get(tokenKey(payment.chain_id, payment.token));
    // Counted, not dropped in silence. A row the catalog cannot resolve is a
    // configuration fault — a token missing from the gateway entirely — and the
    // dashboard says so instead of showing a short list that looks complete.
    if (!token) {
      unresolved++;
      continue;
    }
    const order = orderFrom(payment as PaymentLike, token);
    orders.push({ ...order, price_check: priceCheckFor(order) });
  }
  return { orders, total: page.meta?.total ?? orders.length, unresolved };
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
  const op = startOp("authorize", { payment: short(rail0Id) });
  const merchant = await clientFor("merchant");
  const payment = await merchant.payments.get(rail0Id);

  if (payment.payee.toLowerCase() !== addressFor("merchant").toLowerCase()) {
    // Logged rather than only returned: a payment addressed to someone else arriving at
    // this merchant's authorize is the one refusal here that is interesting on its own.
    logEvent("authorize refused", {
      payment: short(rail0Id),
      reason: "payee is not this merchant",
    });
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
    // The security event of the whole flow — the claim did not cover the catalog — so it
    // gets a line of its own instead of being visible only to whoever read the 422.
    logEvent("authorize refused", {
      payment: short(rail0Id),
      chain: payment.chain_id,
      amount: human,
      reason: "does not cover the catalog price",
    });
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
    // The idempotent path: an earlier call already authorized this and its response was
    // lost. Worth a line, because from the outside it is indistinguishable from a no-op —
    // and because a retry storm shows up here first.
    const known = orderFrom(payment as PaymentLike, token);
    op.ok({ chain: token.chain_id, state: known.state, note: "already authorized" });
    return known;
  }

  const prep = await merchant.payments.authorizePrepare(rail0Id);
  if (!prep.unsigned_transaction) {
    throw new ShopError(502, "gateway returned no unsigned authorize transaction");
  }
  await merchant.payments.authorize(rail0Id, {
    signed_transaction: signTransaction(
      prep.unsigned_transaction,
      env().MERCHANT_PRIVATE_KEY as `0x${string}`,
    ),
  });

  const order = await reread(rail0Id, payment as PaymentLike, token);
  op.ok({ chain: token.chain_id, amount: `${order.total} ${token.symbol}`, state: order.state });
  return order;
}

/** Capture the full escrowed amount — the merchant settles after fulfilment. */
export async function captureOrder(rail0Id: string): Promise<Order> {
  const op = startOp("capture", { payment: short(rail0Id) });
  const order = await requireOrderInState(rail0Id, "in_escrow");
  const merchant = await clientFor("merchant");
  // capture/refund prepare, like create, take the HUMAN decimal amount — the WHOLE of
  // it, converted from base units here rather than reusing `order.total`. That field is
  // rounded to two places for people to read, and capturing a rounded figure would
  // either leave dust in escrow or ask for more than is there.
  const prep = await merchant.payments.capturePrepare(
    rail0Id,
    exactAmount(order.total_base, order.token.decimals),
  );
  if (!prep.unsigned_transaction) {
    throw new ShopError(502, "gateway returned no unsigned capture transaction");
  }
  await merchant.payments.capture(rail0Id, {
    signed_transaction: signTransaction(
      prep.unsigned_transaction,
      env().MERCHANT_PRIVATE_KEY as `0x${string}`,
    ),
  });
  const captured = await reread(rail0Id, undefined, order.token);
  op.ok({
    chain: order.token.chain_id,
    amount: `${order.total} ${order.token.symbol}`,
    state: captured.state,
  });
  return captured;
}

/** Void the authorization — cancels the order and returns the escrow to the buyer. */
export async function voidOrder(rail0Id: string): Promise<Order> {
  const op = startOp("void", { payment: short(rail0Id) });
  const order = await requireOrderInState(rail0Id, "in_escrow");
  const merchant = await clientFor("merchant");
  const prep = await merchant.payments.voidPrepare(rail0Id);
  if (!prep.unsigned_transaction) {
    throw new ShopError(502, "gateway returned no unsigned void transaction");
  }
  await merchant.payments.void(rail0Id, {
    signed_transaction: signTransaction(
      prep.unsigned_transaction,
      env().MERCHANT_PRIVATE_KEY as `0x${string}`,
    ),
  });
  const voided = await reread(rail0Id, undefined, order.token);
  op.ok({
    chain: order.token.chain_id,
    amount: `${order.total} ${order.token.symbol}`,
    state: voided.state,
  });
  return voided;
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
