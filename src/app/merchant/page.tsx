"use client";

import { useCallback, useEffect, useState } from "react";
import type { Order } from "@/lib/store";

const STATE_STYLES: Record<string, string> = {
  awaiting_payment: "bg-neutral-500/10 text-neutral-500",
  authorizing: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  in_escrow: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  capturing: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  settled: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  voiding: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  cancelled: "bg-neutral-500/10 text-neutral-500",
  failed: "bg-red-500/10 text-red-600 dark:text-red-400",
};

export default function Merchant() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/shop/orders");
      const body = await res.json();
      if (res.ok) {
        setOrders(body.orders);
        setError(null);
      } else {
        setError(body.error ?? "failed to load orders");
      }
    } catch {
      setError("failed to load orders");
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, [refresh]);

  const act = async (orderId: string, action: "capture" | "void") => {
    setActing(orderId);
    try {
      const res = await fetch(`/api/shop/orders/${orderId}/${action}`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? `${action} failed`);
      await refresh();
    } finally {
      setActing(null);
    }
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Merchant — orders</h1>
        <p className="text-xs text-neutral-500">
          escrowed funds are captured here after fulfilment
        </p>
      </div>
      {error && (
        <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {orders.length === 0 ? (
        <p className="mt-10 text-center text-sm text-neutral-500">
          No orders yet — ask the buyer agent to shop.
        </p>
      ) : (
        <div className="mt-6 space-y-3">
          {orders.map((order) => (
            <div
              key={order.id}
              className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold">#{order.id}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    STATE_STYLES[order.state] ?? ""
                  }`}
                >
                  {order.state.replace(/_/g, " ")}
                </span>
                <span className="ml-auto text-sm font-semibold">
                  {order.total} {order.token.symbol}
                </span>
              </div>
              <p className="mt-1 text-sm text-neutral-500">
                {order.lines.map((l) => `${l.qty} × ${l.name}`).join(" · ")}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
                {order.token.chain_name && <span>{order.token.chain_name}</span>}
                {order.rail0_id && (
                  <span className="font-mono">
                    {order.rail0_id.slice(0, 10)}…{order.rail0_id.slice(-6)}
                  </span>
                )}
                {order.payment_status && <span>payment: {order.payment_status}</span>}
                {order.error && <span className="text-red-500">{order.error}</span>}
              </div>
              {order.state === "in_escrow" && (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={acting === order.id}
                    onClick={() => act(order.id, "capture")}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  >
                    Fulfil & capture
                  </button>
                  <button
                    type="button"
                    disabled={acting === order.id}
                    onClick={() => act(order.id, "void")}
                    className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900"
                  >
                    Cancel & void
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
