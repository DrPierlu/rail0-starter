"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Order } from "@/lib/order-view";
import { pollWhileVisible } from "@/lib/poll";
import { ChainChip, CopyableId, StateBadge } from "../ui";

/**
 * How often the order list re-reads, while the tab is visible.
 *
 * A tick is not cheap: it refreshes EVERY order against the gateway and rewrites the
 * store document, so this number is the dashboard's whole running cost. Five seconds
 * is well inside what a payment takes to confirm on any chain here — the slowest is
 * Arbitrum Sepolia at ~11 minutes of finality — so nothing is observed later for it.
 */
const POLL_MS = 5000;

/**
 * How many orders the dashboard opens with, and how many more each click adds.
 *
 * Small because the list is polled: every tick is a gateway page, and a shop with a
 * thousand orders would fetch all of them every five seconds to show the handful anyone
 * is actually looking at. Growing the window rather than paging keeps the poll simple —
 * there is one request and one list, just a longer one.
 */
const PAGE = 5;

/**
 * The submitted-action map, narrowed to the orders the list still calls escrowed.
 *
 * This is what releases the buttons again, and it deliberately trusts the ORDER rather
 * than the response that started the action: a capture is only really over when the
 * gateway stops describing the payment as authorized. A timer would have to guess, and
 * the number it would guess is the chain's finality — eleven minutes on the slowest one
 * here.
 *
 * Returns the same object when nothing was dropped, so the five-second poll does not
 * re-render the whole list to say nothing changed.
 */
export function keepEscrowed<T>(
  submitted: Record<string, T>,
  orders: readonly { id: string; state: Order["state"] }[],
): Record<string, T> {
  const escrowed = new Set(orders.filter((o) => o.state === "in_escrow").map((o) => o.id));
  const kept = Object.entries(submitted).filter(([id]) => escrowed.has(id));
  return kept.length === Object.keys(submitted).length ? submitted : Object.fromEntries(kept);
}

export function MerchantDashboard({ devToken }: { devToken?: string }) {
  const [orders, setOrders] = useState<Order[]>([]);
  // How many the gateway is asked for, and how many it says exist. The second is the
  // gateway's own count, so "show more" appears exactly when there is more.
  const [limit, setLimit] = useState(PAGE);
  const [total, setTotal] = useState(0);
  // Rows the gateway returned that this page could not render, because their token is
  // not in the gateway's catalog. Surfaced rather than swallowed: the count is the only
  // sign that the list is shorter than the book.
  const [unresolved, setUnresolved] = useState(0);
  const [acting, setActing] = useState<string | null>(null);
  /**
   * Orders whose capture or void the storefront has ACCEPTED, until the list stops
   * calling them escrowed.
   *
   * `acting` alone only covers the request itself, and that is not the window that
   * matters. A capture answers 202 the moment it is broadcast, and the list read that
   * follows still says `in_escrow` — the order book comes from `GET /payments`, which
   * carries no transactions, so a capture being mined is indistinguishable from one
   * never started. The buttons came back, enabled, on real escrowed funds, and the
   * only thing standing between a second click and a second broadcast was the 409 the
   * route happens to answer.
   */
  const [submitted, setSubmitted] = useState<Record<string, "capture" | "void">>({});
  // Void is the destructive one (it hands the escrow back), so the button
  // asks for a second click instead of firing immediately.
  const [confirmingVoid, setConfirmingVoid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The dashboard is not told the merchant token — it is asked for it. The 401
  // from the order list IS the sign-in trigger, so nothing here has to know
  // whether the cookie is present or still valid.
  const [signedOut, setSignedOut] = useState(false);
  // Prefilled from MERCHANT_TOKEN when the page is served locally — see page.tsx for
  // the two conditions that have to hold before the server hands it over at all.
  const [token, setToken] = useState(devToken ?? "");
  // The automatic sign-in fires at most once. Without this, a devToken the gateway
  // rejects would retry on every poll that re-set `signedOut`.
  const autoSignedIn = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/shop/orders?limit=${limit}`);
      const body = await res.json();
      if (res.ok) {
        setOrders(body.orders);
        setTotal(typeof body.total === "number" ? body.total : body.orders.length);
        setUnresolved(typeof body.unresolved === "number" ? body.unresolved : 0);
        // Forget a submitted action once its order is no longer escrowed — the
        // operation landed (or failed, or someone else moved it), and either way the
        // buttons this was holding down are not rendered any more. An order that has
        // dropped off the list entirely goes with it.
        setSubmitted((current) => keepEscrowed(current, body.orders as Order[]));
        setSignedOut(false);
        setError(null);
      } else if (res.status === 401) {
        // Deliberately leaves `error` alone: this poll repeats, and clearing
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
    // Re-made when the window grows, which is what re-arms the poll on the new size —
    // otherwise "show 10 more" would show them once and the next tick would drop them.
  }, [limit]);

  // Sign in with the token from the server's env: the cookie the route sets is
  // httpOnly, so every later fetch on this page carries it without the page
  // ever holding the credential.
  const submitToken = async (value: string) => {
    try {
      const res = await fetch("/api/shop/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: value }),
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

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitToken(token);
  };

  // Local convenience: sign in by itself so a demo does not stop to ask for a token
  // nobody in the room knows. Only ever reachable with a devToken, which the server
  // withholds unless the request is local (page.tsx).
  useEffect(() => {
    if (!devToken || !signedOut || autoSignedIn.current) return;
    autoSignedIn.current = true;
    void submitToken(devToken);
  });

  // Only while the tab is visible — see pollWhileVisible for why, and for the immediate
  // refresh on return.
  useEffect(() => pollWhileVisible(() => void refresh(), POLL_MS), [refresh]);

  const act = async (orderId: string, action: "capture" | "void") => {
    setActing(orderId);
    setConfirmingVoid(null);
    try {
      const res = await fetch(`/api/shop/orders/${orderId}/${action}`, {
        method: "POST",
      });
      const body = await res.json();
      if (res.ok) {
        // Before the refresh, not after: the refresh is what re-renders the row, and
        // it must find the action already recorded or the buttons flash back for a
        // frame. Only on success — a 409 or a 422 means nothing was broadcast, so the
        // merchant must be able to try again.
        setSubmitted((current) => ({ ...current, [orderId]: action }));
        await refresh();
      } else {
        // Set the message and DON'T refresh. refresh()'s success branch calls
        // setError(null), so refreshing after a failed action wiped the very message
        // that explains why it failed — a 409 or 422 from capture/void was gone
        // within a render. The list is a moment behind until the next poll catches up,
        // which is the right trade for a merchant who needs to read why the action
        // they just took on real escrowed funds did not happen.
        setError(body.error ?? `${action} failed`);
      }
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
          {devToken && (
            // Says so rather than silently filling the field: someone demoing this needs
            // to know the convenience is local-only and does not exist in a deployment.
            <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
              Filled in from <code className="font-mono">MERCHANT_TOKEN</code> because this page is
              served locally — a deployment always asks.
            </p>
          )}
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
                {/* The order id IS the rail0 payment id — 66 characters of it — so it
                    is shown truncated and copies in full on click, rather than printed
                    raw across the row. */}
                <CopyableId value={order.id} />
                <StateBadge state={order.state} />
                <span className="ml-auto flex items-center gap-2 text-sm font-semibold">
                  <ChainChip name={order.token.chain_name} />
                  <span>
                    {order.total} {order.token.symbol}
                  </span>
                </span>
              </div>
              <p className="mt-1 text-sm text-neutral-500">
                {order.lines.map((l) => `${l.qty} × ${l.name}`).join(" · ")}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
                {order.payment_status && <span>payment: {order.payment_status}</span>}
                {order.error && <span className="text-red-500">{order.error}</span>}
              </div>
              {/* The control that guards the money, shown instead of hidden (#2). The lines
                  above ride in the payment's metadata and are written by the BUYER, so they
                  are a claim; the merchant prices that claim against its own catalog before
                  escrowing anything, and this is that comparison. Green is not decoration:
                  a claim that does not cover the catalog price, or that does not price at
                  all, is refused by authorizePayment. */}
              {order.price_check && (
                <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-neutral-500">buyer&apos;s claim</span>
                  <span className="font-semibold tabular-nums">
                    {order.total} {order.token.symbol}
                  </span>
                  <span className="text-neutral-400">vs merchant catalog</span>
                  <span className="font-semibold tabular-nums">
                    {order.price_check.catalog_total} {order.token.symbol}
                  </span>
                  {order.price_check.unpriceable ? (
                    <span className="rounded bg-red-500/10 px-1.5 py-0.5 font-medium text-red-600 dark:text-red-400">
                      cannot be priced — will not be escrowed
                    </span>
                  ) : order.price_check.covered ? (
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-600 dark:text-emerald-400">
                      covered ✓
                    </span>
                  ) : (
                    <span className="rounded bg-red-500/10 px-1.5 py-0.5 font-medium text-red-600 dark:text-red-400">
                      underpaid — will not be escrowed
                    </span>
                  )}
                </p>
              )}
              {order.state === "in_escrow" && submitted[order.id] && (
                // One disabled control saying what is happening, rather than two greyed
                // ones that look like a page that has stopped working. It stays until
                // the gateway's own list agrees the order has moved on, which on a slow
                // chain is a couple of minutes.
                <div className="mt-3">
                  <button
                    type="button"
                    disabled
                    className="rounded-lg bg-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-500 dark:bg-neutral-800"
                  >
                    <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-amber-500 align-middle" />
                    {submitted[order.id] === "capture" ? "Capturing…" : "Voiding…"}
                  </button>
                </div>
              )}
              {order.state === "in_escrow" && !submitted[order.id] && (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={acting === order.id}
                    onClick={() => act(order.id, "capture")}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  >
                    {acting === order.id ? "Submitting…" : "Fulfil & capture"}
                  </button>
                  {confirmingVoid === order.id ? (
                    <>
                      <button
                        type="button"
                        disabled={acting === order.id}
                        onClick={() => act(order.id, "void")}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                      >
                        {acting === order.id ? "Submitting…" : "Confirm void — return the escrow"}
                      </button>
                      <button
                        type="button"
                        disabled={acting === order.id}
                        onClick={() => setConfirmingVoid(null)}
                        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900"
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
          {/* A row whose token the gateway's catalog does not know cannot be priced, so
              it is counted instead of rendered — a configuration fault, not a normal
              state, and saying nothing would make a short list look complete. */}
          {unresolved > 0 && (
            <p className="pt-1 text-center text-[11px] text-amber-600 dark:text-amber-500">
              {unresolved} {unresolved === 1 ? "order is" : "orders are"} in a token this gateway
              has no catalog entry for, so {unresolved === 1 ? "it is" : "they are"} not shown —
              check the gateway's tokens.
            </p>
          )}
          {/* Against the gateway's own count, not against what arrived: a page of ten
              that returned ten says nothing about whether an eleventh exists. Since
              rail0-gateway#193 put chain_id on list rows, every row whose token IS in the
              catalog renders — retired tokens included — so the two numbers now differ
              only by pagination (or by the count above). */}
          {total > limit && (
            <div className="pt-1 text-center">
              <button
                type="button"
                onClick={() => setLimit((current) => current + PAGE)}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                Show {Math.min(PAGE, total - limit)} more
              </button>
              <p className="mt-1.5 text-[11px] text-neutral-400">
                showing {orders.length} of {total}
              </p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
