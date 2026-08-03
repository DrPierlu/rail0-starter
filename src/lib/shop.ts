import { type PaymentDetail, signTransaction } from "@rail0/sdk";
import { env } from "./env";
import { addressFor, clientFor } from "./rail0";
import { getOrder, type Order, type OrderState, updateOrder } from "./store";

// Seller-side orchestration: everything the merchant does against the rail0
// gateway (discover accepted tokens, escrow the buyer's signed payment,
// capture or void it) lives here so the API routes stay thin.

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
 * Attach the buyer's signed payment to an order and immediately move the funds
 * into escrow. Verifies on the gateway that the payment really is what the
 * order asked for (right payee, amount, token, chain, and payer-signed) before
 * broadcasting the authorize — the order's source of truth is the gateway, not
 * the request body.
 */
export async function attachPaymentAndAuthorize(orderId: string, rail0Id: string): Promise<Order> {
  const order = await getOrder(orderId);
  if (!order) throw new ShopError(404, "order not found");
  // `authorizing` with the SAME rail0_id is a RETRY, not a conflict: the
  // write-ahead below binds the payment to the order before the broadcast, so
  // a submit whose broadcast (or whose response) died mid-flight lands here
  // again with the order already advanced. Anything else in a non-initial
  // state stays a 409.
  const retrying = order.state === "authorizing" && order.rail0_id === rail0Id;
  if (!retrying && order.state !== "awaiting_payment") {
    throw new ShopError(409, `order is ${order.state}, expected awaiting_payment`);
  }

  const seller = await clientFor("seller");
  const payment = await seller.payments.get(rail0Id);

  if (payment.payee.toLowerCase() !== addressFor("seller").toLowerCase()) {
    throw new ShopError(422, "payment payee is not this merchant");
  }
  if (payment.chain_id !== order.token.chain_id) {
    throw new ShopError(422, "payment chain does not match the order");
  }
  if (payment.token.toLowerCase() !== order.token.address.toLowerCase()) {
    throw new ShopError(422, "payment token does not match the order");
  }
  if (payment.amount !== order.total_base) {
    throw new ShopError(
      422,
      `payment amount ${payment.amount} does not match order total ${order.total_base}`,
    );
  }
  if (payment.mode !== "authorize") {
    throw new ShopError(422, "payment mode must be authorize (escrow)");
  }
  if (payment.status !== "signed") {
    // On a retry a non-signed status means the earlier broadcast DID land —
    // sync the order from the gateway instead of rejecting the recovery.
    if (retrying) return await refreshOrder(order.id);
    throw new ShopError(422, `payment is ${payment.status}, expected signed`);
  }

  // WRITE-AHEAD: bind the payment to the order BEFORE the broadcast. The old
  // order (write only after `authorize` returned) had an unrecoverable gap: if
  // the broadcast succeeded but the response — or the write — was lost, the
  // buyer's funds sat in escrow while the order stayed `awaiting_payment` with
  // no rail0_id, so nothing could ever reconcile it and the merchant did not
  // know the payment existed. Written first, the worst crash leaves an
  // `authorizing` order that refreshOrder/a retry can always resolve.
  await applyOrder(order.id, {
    rail0_id: rail0Id,
    state: "authorizing",
    payment_status: payment.status,
  });

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

  return (await getOrder(order.id)) as Order;
}

/** Capture the full escrowed amount — the merchant settles after fulfilment. */
export async function captureOrder(orderId: string): Promise<Order> {
  const order = await requireOrderInState(orderId, "in_escrow");
  const seller = await clientFor("seller");
  // capture/refund prepare, like create, take the HUMAN decimal amount.
  const prep = await seller.payments.capturePrepare(order.rail0_id, order.total);
  if (!prep.unsigned_transaction) {
    throw new ShopError(502, "gateway returned no unsigned capture transaction");
  }
  await seller.payments.capture(order.rail0_id, {
    signed_transaction: signTransaction(
      prep.unsigned_transaction,
      env().SELLER_PRIVATE_KEY as `0x${string}`,
    ),
  });
  return await applyOrder(order.id, { state: "capturing" });
}

/** Void the authorization — cancels the order and returns the escrow to the buyer. */
export async function voidOrder(orderId: string): Promise<Order> {
  const order = await requireOrderInState(orderId, "in_escrow");
  const seller = await clientFor("seller");
  const prep = await seller.payments.voidPrepare(order.rail0_id);
  if (!prep.unsigned_transaction) {
    throw new ShopError(502, "gateway returned no unsigned void transaction");
  }
  await seller.payments.void(order.rail0_id, {
    signed_transaction: signTransaction(
      prep.unsigned_transaction,
      env().SELLER_PRIVATE_KEY as `0x${string}`,
    ),
  });
  return await applyOrder(order.id, { state: "voiding" });
}

/**
 * Lazily sync an order with the gateway on every read — no background jobs.
 * The mapping is per-state, not global: while a capture is in flight the
 * payment still reads `authorized`, and a global status→state map would
 * regress the order to in_escrow (and then stop refreshing it). Only the
 * statuses that genuinely END the order's current phase advance it; anything
 * else just updates the mirrored payment_status. `in_escrow` is refreshable
 * too, so a capture/void done outside this app (e.g. from rail0-admin) is
 * picked up. A failed tx of the in-flight operation parks the order in
 * `failed` with the decoded on-chain error.
 */
export async function refreshOrder(orderId: string): Promise<Order> {
  const order = await getOrder(orderId);
  if (!order) throw new ShopError(404, "order not found");
  const completions = REFRESHABLE[order.state];
  if (!order.rail0_id || !completions) return order;

  const seller = await clientFor("seller");
  const payment = await seller.payments.get(order.rail0_id);

  const nextState = completions[payment.status];
  if (nextState) {
    return await applyOrder(order.id, {
      state: nextState,
      payment_status: payment.status,
    });
  }

  const failure = failureFor(payment, IN_FLIGHT_OPERATION[order.state]);
  if (failure) {
    return await applyOrder(order.id, {
      state: "failed",
      payment_status: payment.status,
      error: failure,
    });
  }

  return await applyOrder(order.id, { payment_status: payment.status });
}

// Per-state completion map: which payment statuses move the order forward
// from each refreshable state. `partially_captured` maps to settled from
// capturing because this app only ever captures the full amount — a partial
// capture can only come from outside and still ends the fulfilment phase.
const SETTLED_OR_UNDONE: Partial<Record<string, OrderState>> = {
  captured: "settled",
  partially_captured: "settled",
  voided: "cancelled",
  released: "cancelled",
};

const REFRESHABLE: Partial<Record<OrderState, Partial<Record<string, OrderState>>>> = {
  authorizing: { authorized: "in_escrow", ...SETTLED_OR_UNDONE },
  in_escrow: SETTLED_OR_UNDONE,
  capturing: SETTLED_OR_UNDONE,
  voiding: SETTLED_OR_UNDONE,
};

const IN_FLIGHT_OPERATION: Partial<Record<OrderState, string>> = {
  authorizing: "authorize",
  capturing: "capture",
  voiding: "void",
};

function failureFor(payment: PaymentDetail, operation?: string): string | undefined {
  if (!operation) return undefined;
  const failed = (payment.transactions ?? []).find(
    (t) => t.operation === operation && t.status === "failed",
  );
  if (!failed) return undefined;
  return (
    failed.error_message ??
    failed.error_code ??
    payment.last_error_message ??
    "on-chain operation failed"
  );
}

type EscrowedOrder = Order & { rail0_id: string };

async function requireOrderInState(orderId: string, state: OrderState): Promise<EscrowedOrder> {
  const order = await getOrder(orderId);
  if (!order) throw new ShopError(404, "order not found");
  if (order.state !== state || !order.rail0_id) {
    throw new ShopError(409, `order is ${order.state}, expected ${state}`);
  }
  return order as EscrowedOrder;
}

// updateOrder returns undefined only for an unknown id; every caller here has
// just loaded the order, so absence is a store bug worth failing loudly on.
async function applyOrder(id: string, patch: Parameters<typeof updateOrder>[1]): Promise<Order> {
  const updated = await updateOrder(id, patch);
  if (!updated) throw new ShopError(500, "order disappeared from the store");
  return updated;
}

export class ShopError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
