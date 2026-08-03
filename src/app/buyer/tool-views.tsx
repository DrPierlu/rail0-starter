"use client";

import { useState } from "react";
import type { Order } from "@/lib/store";
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

export function ToolView({ part }: { part: ToolPart }) {
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
      return <ProductGrid products={(output?.products as Product[]) ?? []} />;
    case "add_to_cart":
    case "view_cart":
    case "remove_from_cart":
    case "clear_cart":
      return <CartTable cart={(output?.cart as CartLine[]) ?? []} />;
    case "payment_options":
      return <PaymentOptions methods={(output?.payment_methods as PaymentMethod[]) ?? []} />;
    // checkout_submit is the moment funds move into escrow — the demo's
    // payoff. It used to match a "checkout" case for a tool that no longer
    // exists (the flow split into begin/payment/submit), so the settle step
    // fell through to the generic JSON chip and the live OrderCard
    // (authorizing -> in_escrow polling) never appeared.
    case "checkout_submit":
      return <OrderCard orderId={output?.order_id as string} />;
    case "order_status": {
      const order = output?.order as Order | undefined;
      return order ? <OrderCard orderId={order.id} initial={order} /> : <ToolChip part={part} />;
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

function ProductGrid({ products }: { products: Product[] }) {
  const shown = products.slice(0, PRODUCT_GRID_LIMIT);
  const more = products.length - shown.length;
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
              <span className="font-mono font-semibold">#{o.id}</span>
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
