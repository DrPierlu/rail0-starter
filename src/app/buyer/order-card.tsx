"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TERMINAL_STATES } from "@/lib/order-ui";
import { pollWhileVisible } from "@/lib/poll";
import type { Order } from "@/lib/store";
import { CopyableId, StateBadge } from "../ui";

/** Buyer-side poll: the shopper is watching an escrow confirm, so it stays brisk. */
const POLL_MS = 3000;

/**
 * An order card in the chat.
 *
 * `live` decides whether it polls. It used to always poll, which was right when it was
 * the only place an order's state appeared — the escrow confirms asynchronously, so the
 * buyer watched authorize → in_escrow happen instead of asking the agent to re-check.
 * But the agent re-checks by calling order_status, and every call rendered another card:
 * several copies of one order, each with its own 3s loop, each doing a read-modify-write
 * on the store.
 *
 * Now the docked CheckoutPanel is the single live surface for the ACTIVE order and does
 * that polling once. Everything in the transcript is a snapshot — what was true when the
 * agent looked — so it renders `initial` and leaves it alone.
 */
export function OrderCard({
  orderId,
  initial,
  live = true,
}: {
  orderId: string;
  initial?: Order;
  /** Poll the storefront until terminal. False renders `initial` as a snapshot. */
  live?: boolean;
}) {
  const [order, setOrder] = useState<Order | undefined>(initial);
  const [gone, setGone] = useState(false);

  // Keep `initial` in step when the parent re-fetches it (the panel passes the order it
  // polled), so a snapshot card is not frozen at the value it first mounted with.
  useEffect(() => {
    if (initial) setOrder(initial);
  }, [initial]);

  const state = order?.state;
  useEffect(() => {
    if (!live || gone || (state && TERMINAL_STATES.has(state))) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/shop/orders/${orderId}`);
        if (cancelled) return;
        // The only terminal answer, and it now means one thing: the merchant's
        // store has no such order. A gateway read that failed used to arrive here
        // as a 404 too, which latched this card on "order not found" — and stopped
        // the poll for good — while the order was in the store all along. The route
        // answers the stored snapshot (flagged stale) for that case instead.
        if (res.status === 404) {
          setGone(true);
          return;
        }
        const body = (await res.json()) as { order?: Order };
        if (body.order) setOrder(body.order);
      } catch {
        // transient — next tick retries
      }
    };
    // Visibility-gated: a buyer tab left open after a purchase would otherwise poll
    // this order forever, and the answer stops changing once it settles anyway.
    const stop = pollWhileVisible(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [orderId, state, gone, live]);

  if (gone) {
    return (
      <div className="rounded-xl border border-neutral-200 p-3 text-xs text-neutral-500 dark:border-neutral-800">
        order {orderId} not found
      </div>
    );
  }
  if (!order) {
    return (
      <div className="rounded-xl border border-neutral-200 p-3 text-xs text-neutral-400 dark:border-neutral-800">
        loading order {orderId}…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold">#{order.id}</span>
        <StateBadge state={order.state} />
        <span className="ml-auto text-sm font-semibold">
          {order.total} {order.token.symbol}
        </span>
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        {order.lines.map((l) => `${l.qty} × ${l.name}`).join(" · ")}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
        {order.token.chain_name && <span>{order.token.chain_name}</span>}
        {order.rail0_id && <CopyableId value={order.rail0_id} />}
        {order.error && <span className="text-red-500">{order.error}</span>}
        <Link href="/merchant" className="ml-auto text-neutral-400 hover:underline">
          view on /merchant →
        </Link>
      </div>
    </div>
  );
}
