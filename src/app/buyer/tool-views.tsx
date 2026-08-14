"use client";

import { useState } from "react";
import { shortId } from "@/lib/order-ui";
import type { Order } from "@/lib/order-view";
import { StateBadge } from "../ui";
import { OrderCard } from "./order-card";

// Rendering for the agent's tool calls. The tools the demo revolves around
// (catalog, cart, payment options, checkout) get purpose-built views instead
// of a JSON dump; everything else falls back to the collapsible ToolChip so
// what the agent did stays inspectable.

export interface ToolPart {
  type: string;
  state: "input-streaming" | "input-available" | "output-available" | "output-error";
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

interface Product {
  id: string;
  name: string;
  description: string;
  price: string;
  category: string;
}

interface CartLine {
  product_id: string;
  name: string;
  price: string;
  qty: number;
}

interface PaymentMethod {
  chain_id: number;
  chain_name?: string;
  symbol: string;
}

export function ToolView({
  part,
  activeOrderId,
}: {
  part: ToolPart;
  /** The order the docked panel is live on — rendered here as a reference, not a card. */
  activeOrderId?: string;
}) {
  const name = part.type.replace(/^tool-/, "");

  // Rich views only make sense once the tool has produced output; while it
  // runs (or if it errored) the generic chip already tells that story well.
  if (part.state !== "output-available") return <ToolChip part={part} />;

  const output = part.output as Record<string, unknown> | undefined;
  if (output && typeof output.error === "string") {
    return <ToolError name={name} message={output.error} />;
  }

  switch (name) {
    case "list_products":
      return (
        <ProductGrid
          products={(output?.products as Product[]) ?? []}
          total={typeof output?.total === "number" ? output.total : undefined}
        />
      );
    case "add_to_cart":
    case "view_cart":
    case "remove_from_cart":
    case "clear_cart":
      return <CartTable cart={(output?.cart as CartLine[]) ?? []} />;
    case "payment_options":
      return <PaymentOptions methods={(output?.payment_methods as PaymentMethod[]) ?? []} />;
    // The AUTONOMOUS checkout — the agent's own wallet paid, so the tool comes back with
    // a finished order and there was never a card. (A human checkout is interactive and
    // never reaches here: EveToolView renders it as a pointer to the docked panel.)
    //
    // The transcript never holds a LIVE order: the docked panel is the single place an
    // order's state updates. So the active order is a reference pointing there, and any
    // other order is a snapshot of what the agent saw — which is what a transcript
    // should be.
    case "checkout_begin": {
      const orderId = output?.order_id as string | undefined;
      if (!orderId) return <ToolChip part={part} />;
      if (orderId === activeOrderId) return <OrderReference orderId={orderId} />;
      return <OrderCard orderId={orderId} live={false} />;
    }
    case "order_status": {
      const order = output?.order as Order | undefined;
      if (!order) return <ToolChip part={part} />;
      if (order.id === activeOrderId) return <OrderReference orderId={order.id} />;
      return <OrderCard orderId={order.id} initial={order} live={false} />;
    }
    case "my_orders":
      return <OrderList orders={(output?.orders as Order[]) ?? []} />;
    default:
      return <ToolChip part={part} />;
  }
}

function Caption({ children }: { children: string }) {
  return (
    <div className="mb-1.5 flex items-center gap-2 font-mono text-[11px] text-neutral-400">
      <span className="size-2 rounded-full bg-emerald-500" />
      {children}
    </div>
  );
}

function ToolError({ name, message }: { name: string; message: string }) {
  return (
    <div className="rounded-lg border border-red-300 px-3 py-2 dark:border-red-900">
      <div className="flex items-center gap-2 font-mono text-[11px] text-neutral-400">
        <span className="size-2 rounded-full bg-red-500" />
        {name}
      </div>
      <p className="mt-1 text-xs text-red-600 dark:text-red-400">{message}</p>
    </div>
  );
}

const PRODUCT_GRID_LIMIT = 8;

function ProductGrid({ products, total }: { products: Product[]; total?: number }) {
  const shown = products.slice(0, PRODUCT_GRID_LIMIT);
  // Against the MATCH count, not the page: the storefront caps what it sends, so
  // counting what arrived would under-report how much the shopper has not seen.
  const more = (total ?? products.length) - shown.length;
  return (
    <div>
      <Caption>list_products</Caption>
      {products.length === 0 ? (
        <p className="text-xs text-neutral-500">no matching products</p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {shown.map((p) => (
              <div
                key={p.id}
                className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold">{p.name}</span>
                  <span className="ml-auto text-xs font-semibold">${p.price}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11px] text-neutral-500">{p.description}</p>
              </div>
            ))}
          </div>
          {more > 0 && (
            <p className="mt-1.5 text-[11px] text-neutral-400">
              +{more} more — ask the agent to narrow it down
            </p>
          )}
        </>
      )}
    </div>
  );
}

function CartTable({ cart }: { cart: CartLine[] }) {
  const total = cart.reduce((sum, l) => sum + Number(l.price) * l.qty, 0);
  return (
    <div>
      <Caption>cart</Caption>
      {cart.length === 0 ? (
        <p className="text-xs text-neutral-500">the cart is empty</p>
      ) : (
        <div className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800">
          {cart.map((l) => (
            <div key={l.product_id} className="flex gap-2 py-0.5 text-xs">
              <span>
                {l.qty} × {l.name}
              </span>
              <span className="ml-auto tabular-nums">${(Number(l.price) * l.qty).toFixed(2)}</span>
            </div>
          ))}
          <div className="mt-1 flex gap-2 border-t border-neutral-200 pt-1 text-xs font-semibold dark:border-neutral-800">
            <span>total</span>
            <span className="ml-auto tabular-nums">${total.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PaymentOptions({ methods }: { methods: PaymentMethod[] }) {
  return (
    <div>
      <Caption>payment_options</Caption>
      <div className="flex flex-wrap gap-1.5">
        {methods.length === 0 ? (
          <p className="text-xs text-neutral-500">the merchant accepts no tokens right now</p>
        ) : (
          methods.map((m) => (
            <span
              key={`${m.chain_id}-${m.symbol}`}
              className="rounded-full border border-neutral-200 px-2.5 py-0.5 text-xs dark:border-neutral-800"
            >
              {m.chain_name ?? `chain ${m.chain_id}`} · {m.symbol}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function OrderList({ orders }: { orders: Order[] }) {
  return (
    <div>
      <Caption>my_orders</Caption>
      {orders.length === 0 ? (
        <p className="text-xs text-neutral-500">no orders yet</p>
      ) : (
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800">
          {orders.map((o) => (
            <div
              key={o.id}
              className="flex items-center gap-2 border-b border-neutral-200 px-3 py-1.5 text-xs last:border-b-0 dark:border-neutral-800"
            >
              <span className="font-mono font-semibold">{shortId(o.id)}</span>
              <StateBadge state={o.state} />
              <span className="ml-auto tabular-nums font-semibold">
                {o.total} {o.token.symbol}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ToolChip({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const name = part.type.replace(/^tool-/, "");
  const done = part.state === "output-available";
  const error = part.state === "output-error";
  const isPayment = name.startsWith("checkout");

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs"
      >
        <span
          className={
            error
              ? "size-2 rounded-full bg-red-500"
              : done
                ? "size-2 rounded-full bg-emerald-500"
                : "size-2 animate-pulse rounded-full bg-amber-500"
          }
        />
        <span>{name}</span>
        {isPayment && (
          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
            rail0 escrow
          </span>
        )}
        <span className="ml-auto text-neutral-400">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto border-t border-neutral-200 px-3 py-2 text-[11px] leading-relaxed dark:border-neutral-800">
          {JSON.stringify(
            { input: part.input, output: part.output, error: part.errorText },
            null,
            2,
          )}
        </pre>
      )}
    </div>
  );
}

/**
 * The order an OrderCard would be put on screen for by this tool output, if any.
 *
 * Exported so the transcript can tell that two parts render a card for the SAME order
 * and keep one — the dedupe has to happen across messages, which no single part can
 * see. Kept here, next to the switch that decides it, so the two cannot drift.
 */
export function orderCardOrderId(toolName: string, output: unknown): string | undefined {
  const o = output as Record<string, unknown> | undefined;
  // Only the autonomous checkout carries an order: the human one has not created the
  // payment yet when it returns, and its card reports the id to the panel directly.
  if (toolName === "checkout_begin") {
    return typeof o?.order_id === "string" ? o.order_id : undefined;
  }
  if (toolName === "order_status") {
    const order = o?.order as { id?: unknown } | undefined;
    return typeof order?.id === "string" ? order.id : undefined;
  }
  return undefined;
}

/** Points at the docked panel, which is where this order is live. */
function OrderReference({ orderId }: { orderId: string }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-xs text-neutral-500 dark:border-neutral-700">
      ↓ order #{orderId} — live in the box above the message field
    </div>
  );
}
