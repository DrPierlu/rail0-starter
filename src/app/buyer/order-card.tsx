"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TERMINAL_STATES } from "@/lib/order-ui";
import type { Order } from "@/lib/store";
import { CopyableId, StateBadge } from "../ui";

/**
 * Live order card rendered in the chat after a checkout (and for
 * order_status lookups). The escrow confirms asynchronously, so the card
 * polls the storefront until the order reaches a terminal state — the user
 * watches authorize → in_escrow happen instead of having to ask the agent to
 * re-check. `in_escrow` keeps polling on purpose: a capture or void done on
 * /merchant flips this card to settled/cancelled in place.
 */
export function OrderCard({ orderId, initial }: { orderId: string; initial?: Order }) {
  const [order, setOrder] = useState<Order | undefined>(initial);
  const [gone, setGone] = useState(false);

  const state = order?.state;
  useEffect(() => {
    if (gone || (state && TERMINAL_STATES.has(state))) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/shop/orders/${orderId}`);
        if (cancelled) return;
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
    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [orderId, state, gone]);

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
