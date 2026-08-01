import { defineState } from "eve/context";

/**
 * The cart, owned by the AGENT.
 *
 * It used to live in the merchant's store (`src/lib/store.ts`) and the tools read
 * it with a direct import — a function call across what is meant to be an HTTP
 * boundary. Two things were wrong with that:
 *
 *   It breaks the moment the three pieces are deployed separately, which is the
 *   plan. The agent process would get its own copy of that store: `add_to_cart`
 *   writes here, `/api/shop/*` reads there. The order still comes out right
 *   (checkout sends `items[]` over HTTP), so the failure is not a crash — it is two
 *   carts that quietly disagree, which is worse.
 *
 *   And the ownership was wrong regardless of deployment. A cart is buyer state: it
 *   exists before an order does, and the merchant has no business knowing what you
 *   are still considering. It should learn of you at order creation, with a finished
 *   list of items.
 *
 * eve's session state is the right home: durable across steps, scoped to the
 * conversation, shared by every tool that imports this handle — and, being per
 * session, two buyers no longer share one global cart the way a single store file
 * made them. (#5)
 */
export interface CartLine {
  product_id: string;
  name: string;
  /** Human decimal, as the catalog quotes it (e.g. "5.20"). */
  price: string;
  qty: number;
}

interface CartState {
  readonly lines: readonly CartLine[];
}

const cartState = defineState<CartState>("rail0-starter.cart", () => ({ lines: [] }));

// ── Pure reducers ────────────────────────────────────────────────────
// Split out from the state handle so the cart's actual RULES stay testable:
// defineState only resolves inside eve's runtime, so anything that touches it
// cannot run in a unit test. These can.

/** Add a line, merging quantities when the product is already there. */
export function mergeLine(lines: readonly CartLine[], line: CartLine): CartLine[] {
  return lines.some((l) => l.product_id === line.product_id)
    ? lines.map((l) => (l.product_id === line.product_id ? { ...l, qty: l.qty + line.qty } : l))
    : [...lines, line];
}

/**
 * Remove a product, or `qty` units of it.
 *
 * Removing more units than are present removes the line: asking for 5 of something
 * you have 2 of means "take it out", not an error the model then has to explain to
 * the user.
 */
export function removeLine(
  lines: readonly CartLine[],
  productId: string,
  qty?: number,
): CartLine[] {
  return lines.flatMap((l) => {
    if (l.product_id !== productId) return [l];
    if (qty === undefined || l.qty <= qty) return [];
    return [{ ...l, qty: l.qty - qty }];
  });
}

// ── State-bound helpers (the tools' surface) ──────────────────────────

export async function getCart(): Promise<CartLine[]> {
  return [...(await cartState.get()).lines];
}

export async function addToCart(line: CartLine): Promise<CartLine[]> {
  await cartState.update((state) => ({ lines: mergeLine(state.lines, line) }));
  return getCart();
}

export async function removeFromCart(productId: string, qty?: number): Promise<CartLine[]> {
  await cartState.update((state) => ({ lines: removeLine(state.lines, productId, qty) }));
  return getCart();
}

export async function clearCart(): Promise<void> {
  await cartState.update(() => ({ lines: [] }));
}
