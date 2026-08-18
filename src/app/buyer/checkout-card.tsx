"use client";

import type { SigningPayload } from "@rail0/sdk";
import { useState } from "react";
import type { SigningStage } from "@/lib/checkout-step";
import type { CartLine, Order } from "@/lib/order-view";
import { useWallet, WalletConnect, walletErrorMessage } from "./wallet";

/**
 * The human checkout, start to finish, in one card.
 *
 * It used to be two cards driven by three tool calls, with the signatures parked in a
 * server-side stash in between. The stash is gone, and that is what merged the cards:
 * whoever holds a signature has to be the one that uses it, and both signatures are
 * produced HERE, in the browser, by a wallet this server never sees. So this component
 * calls the checkout itself —
 *
 *   personal_sign  → POST /api/checkout/create  (verify, session, create the payment)
 *   signTypedData  → POST /api/checkout/submit  (sign the payment, merchant escrows it)
 *
 * — and the agent is told the result afterwards, in the chat, like any other outcome.
 * Nothing sensitive travels through the model: the SIWE text comes straight from the
 * tool output, and the EIP-712 payload never leaves this component at all.
 *
 * There is deliberately no way to resume it. Everything in flight lives in this
 * component's state, which is the honest expression of a checkout that persists nothing:
 * abandon it and there is a quote nobody kept and, at worst, an unsigned payment on the
 * gateway that expires on its own.
 */

export interface CheckoutOutput {
  step: "checkout";
  checkout_id: string;
  items: { product_id: string; qty: number }[];
  chain_id: number;
  token_address: string;
  lines: CartLine[];
  total: string;
  /** The stablecoin's symbol, for display. */
  token: string;
}

/** Narrow an arbitrary tool output to a checkout, or null. */
export function asCheckoutOutput(output: unknown): CheckoutOutput | null {
  const value = output as CheckoutOutput | undefined;
  return value?.step === "checkout" && typeof value.checkout_id === "string" ? value : null;
}

/**
 * Identity of a checkout in the transcript. Stable across renders and across the
 * transcript being restored from sessionStorage, unlike a part index — which is what the
 * docked slot has to key on to know whether THIS checkout is the one still in flight.
 */
export function checkoutKey(output: CheckoutOutput): string {
  return `checkout:${output.checkout_id}`;
}

/** Where the card is: the two signatures, and the two requests that follow them. */
export type CheckoutStage = SigningStage | "creating" | "submitting" | "done";

export function CheckoutCard({
  output,
  onContinue,
  onStage,
  onOrder,
  onDone,
  busy,
}: {
  output: CheckoutOutput;
  /** Sends a chat message, so the agent learns how the checkout ended. */
  onContinue: (text: string) => void;
  /** Reports the stage so the panel's progress row can follow it. */
  onStage?: (stage: CheckoutStage) => void;
  /** Reports the payment id as soon as it exists, so the panel can go live on it. */
  onOrder?: (rail0Id: string) => void;
  /** Reports that this checkout is finished and no longer owed anything. */
  onDone?: (key: string) => void;
  busy: boolean;
}) {
  const { wallet } = useWallet();
  const [stage, setStage] = useState<CheckoutStage>("sign_login");
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<{ rail0_id: string; payload: SigningPayload } | null>(
    null,
  );

  const advance = (next: CheckoutStage) => {
    setStage(next);
    onStage?.(next);
  };

  /** Step 2: prove the wallet, and create the payment as its owner — one request. */
  const signIn = async () => {
    if (!wallet) return;
    setError(null);
    try {
      // The challenge is fetched HERE, per attempt, from the wallet connected right now.
      // Not handed down by the agent: the address is a fact of this browser, and a model
      // asked to relay it can simply not do so — which read as "no wallet connected" for
      // a shopper looking at their connected wallet. Per attempt, because a SIWE nonce is
      // single-use and a card left open would otherwise sign a spent one.
      const { siwe_message } = await post<{ siwe_message: string }>("/api/checkout/challenge", {
        address: wallet.address,
      });
      const signature = await wallet.signMessage(siwe_message);
      advance("creating");
      const created = await post<{ rail0_id: string; signing_payload: SigningPayload }>(
        "/api/checkout/create",
        {
          // The card's identity, doubling as the Idempotency-Key. This card can run its
          // create more than once — the wallet prompt is cancellable, and a remount
          // (hopping to /merchant mid-checkout) restarts it having lost the payment id it
          // held in state — and every one of those runs used to mint a NEW payment.
          checkout_id: output.checkout_id,
          items: output.items,
          chain_id: output.chain_id,
          token_address: output.token_address,
          siwe_message,
          siwe_signature: signature,
        },
      );
      setPayment({ rail0_id: created.rail0_id, payload: created.signing_payload });
      // The order exists from here on, so the panel can start polling it even if the
      // buyer never signs the second half — an unsigned payment is a real thing to see.
      onOrder?.(created.rail0_id);
      advance("sign_payment");
    } catch (err) {
      // Back to where the retry is possible. A failed create leaves nothing behind
      // except a spent SIWE nonce, so the retry needs a fresh checkout — say so.
      advance("sign_login");
      setError(walletErrorMessage(err));
    }
  };

  /** Step 3: authorize the transfer, and hand it to the merchant to escrow. */
  const payNow = async () => {
    if (!wallet || !payment) return;
    setError(null);
    try {
      const signature = await wallet.signTypedData(payment.payload);
      advance("submitting");
      const { order } = await post<{ order: Order }>("/api/checkout/submit", {
        rail0_id: payment.rail0_id,
        signature,
      });
      advance("done");
      onOrder?.(order.id);
      onDone?.(checkoutKey(output));
      onContinue(
        `I signed and submitted the payment — the order is ${order.id}. Check its status.`,
      );
    } catch (err) {
      advance("sign_payment");
      setError(walletErrorMessage(err));
    }
  };

  const working = stage === "creating" || stage === "submitting";
  const title =
    stage === "sign_login" || stage === "creating"
      ? "Step 1 · Sign in as the buyer"
      : stage === "done"
        ? "Paid — the escrow is confirming"
        : "Step 2 · Sign the payment";
  const explain =
    stage === "sign_login" || stage === "creating"
      ? "A SIWE message proving you control the wallet — no funds move."
      : stage === "done"
        ? "The merchant has broadcast the authorization; the funds lock on-chain in a few blocks."
        : "The EIP-3009 authorization that lets the escrow pull the payment. Signing is free (gasless); funds move only into escrow.";

  return (
    <div className="rounded-xl border border-blue-300 px-4 py-3 dark:border-blue-900">
      <div className="flex items-center gap-2">
        <span
          className={
            stage === "done"
              ? "size-2 rounded-full bg-emerald-500"
              : "size-2 animate-pulse rounded-full bg-blue-500"
          }
        />
        <span className="text-xs font-semibold">{title}</span>
        <span className="ml-auto text-xs font-semibold">
          {output.total} {output.token}
        </span>
      </div>
      <p className="mt-1 text-xs text-neutral-500">{explain}</p>
      <p className="mt-1 text-xs text-neutral-500">
        {output.lines.map((line) => `${line.qty} × ${line.name}`).join(" · ")}
      </p>

      {/* No preview of the SIWE text: it is fetched at the moment you press the button,
          so there is nothing to show before then — and the wallet displays the exact
          bytes it is about to sign, which is the copy that matters. */}
      {payment && stage !== "sign_login" && (
        <p className="mt-2 font-mono text-[11px] text-neutral-500">
          rail0_id {payment.rail0_id.slice(0, 10)}…{payment.rail0_id.slice(-6)}
        </p>
      )}

      <div className="mt-3 flex items-center gap-3">
        {stage === "done" ? (
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
            Signed and submitted ✓
          </span>
        ) : !wallet ? (
          // The connect controls are HERE, not in a strip at the top of the page: this
          // card is the moment the wallet is needed, and sending the user off to find
          // a control elsewhere on screen is what made the old version unclear.
          <div className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">
              Connect the buyer wallet to sign — no funds move until you approve.
            </span>
            <WalletConnect />
          </div>
        ) : (
          <button
            type="button"
            disabled={working || busy}
            onClick={() => void (stage === "sign_payment" ? payNow() : signIn())}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-black"
          >
            {stage === "creating"
              ? "Creating the payment…"
              : stage === "submitting"
                ? "Submitting…"
                : stage === "sign_payment"
                  ? `Pay ${output.total} ${output.token}`
                  : "Sign in with MetaMask"}
          </button>
        )}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    </div>
  );
}

/** A JSON POST that raises the server's own message — the one worth showing. */
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(parsed.error ?? `${path} failed with ${response.status}`);
  return parsed;
}
