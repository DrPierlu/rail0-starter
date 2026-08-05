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
  // The dashboard is not told the merchant token — it is asked for it. The 401
  // from the order list IS the sign-in trigger, so nothing here has to know
  // whether the cookie is present or still valid.
  const [signedOut, setSignedOut] = useState(false);
  const [token, setToken] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/shop/orders");
      const body = await res.json();
      if (res.ok) {
        setOrders(body.orders);
        setSignedOut(false);
        setError(null);
      } else if (res.status === 401) {
        // Deliberately leaves `error` alone: this poll runs every 4s, and clearing
        // it here wiped the "invalid merchant token" the sign-in had just set,
        // before it could be read. A stale message clears on the next success.
        setSignedOut(true);
        setOrders([]);
      } else {
        // Everything else keeps its message — notably the 500 that names an
        // unset MERCHANT_TOKEN, which no amount of signing in would fix.
        setError(body.error ?? "failed to load orders");
      }
    } catch {
      setError("failed to load orders");
    }
  }, []);

  // Sign in with the token from the server's env: the cookie the route sets is
  // httpOnly, so every later fetch on this page carries it without the page
  // ever holding the credential.
  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const res = await fetch("/api/shop/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "sign-in failed");
        return;
      }
      setToken("");
      setError(null);
      await refresh();
    } catch {
      setError("sign-in failed");
    }
  };

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
    } catch {
      // The fetch itself failing (the server down mid-action, a non-JSON body) had
      // no handler: the promise onClick returned rejected unhandled, so nothing was
      // shown and the button simply snapped back as if the click had never happened
      // — on capture and void, the two things that move real escrowed funds. Same
      // message shape as refresh()/signIn(). The refresh above is skipped on this
      // path, which is what keeps the message on screen.
      setError(`${action} failed — the storefront could not be reached`);
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
      {signedOut ? (
        <form onSubmit={signIn} className="mx-auto mt-10 max-w-sm">
          <label htmlFor="merchant-token" className="text-sm font-medium">
            Merchant token
          </label>
          <p className="mt-1 text-xs text-neutral-500">
            The value of <code className="font-mono">MERCHANT_TOKEN</code> on the server. Capture
            and void move real escrowed funds, so the dashboard is gated on it.
          </p>
          <input
            id="merchant-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="mt-3 w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-950"
          />
          <button
            type="submit"
            disabled={token.length === 0}
            className="mt-3 w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
          >
            Sign in
          </button>
        </form>
      ) : orders.length === 0 ? (
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
