"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Order } from "@/lib/store";
import { CopyableId, StateBadge } from "../ui";

export default function Merchant() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  // Void is the destructive one (it hands the escrow back), so the button
  // asks for a second click instead of firing immediately.
  const [confirmingVoid, setConfirmingVoid] = useState<string | null>(null);
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
    setConfirmingVoid(null);
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
          No orders yet —{" "}
          <Link
            href="/buyer"
            className="underline hover:text-neutral-700 dark:hover:text-neutral-300"
          >
            ask the buyer agent to shop
          </Link>
          .
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
                <StateBadge state={order.state} />
                <span className="ml-auto text-sm font-semibold">
                  {order.total} {order.token.symbol}
                </span>
              </div>
              <p className="mt-1 text-sm text-neutral-500">
                {order.lines.map((l) => `${l.qty} × ${l.name}`).join(" · ")}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
                {order.token.chain_name && <span>{order.token.chain_name}</span>}
                {order.rail0_id && <CopyableId value={order.rail0_id} />}
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
                  {confirmingVoid === order.id ? (
                    <>
                      <button
                        type="button"
                        disabled={acting === order.id}
                        onClick={() => act(order.id, "void")}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                      >
                        Confirm void — return the escrow
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingVoid(null)}
                        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
                      >
                        Keep the order
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={acting === order.id}
                      onClick={() => setConfirmingVoid(order.id)}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900"
                    >
                      Cancel & void
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
