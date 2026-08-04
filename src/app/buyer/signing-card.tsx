"use client";

import type { SigningPayload } from "@rail0/sdk";
import { useState } from "react";
import { useWallet } from "./wallet";

// The two signature hand-off cards of the keyless checkout. Each signs with
// the browser wallet, POSTs the signature to the storefront stash (never
// through the chat), then nudges the agent to move to the next step.

export interface SignLoginOutput {
  step: "sign_login";
  order_id: string;
  total: string;
  token: string;
  siwe_message: string;
}

export interface SignPaymentOutput {
  step: "sign_payment";
  order_id: string;
  rail0_id: string;
  signing_payload: SigningPayload;
}

export type SigningOutput = SignLoginOutput | SignPaymentOutput;

/** Narrow an arbitrary tool output to a signing step, or null. */
export function asSigningOutput(output: unknown): SigningOutput | null {
  const step = (output as { step?: string } | undefined)?.step;
  return step === "sign_login" || step === "sign_payment" ? (output as SigningOutput) : null;
}

// Identity of a signing step: which step, on which order. Stable across renders and
// across the transcript being restored from sessionStorage, unlike a part index —
// which is what the pinned slot has to key on to know whether THIS card is the one
// still waiting for a signature.
export function signingKey(output: SigningOutput): string {
  return `${output.step}:${output.order_id}`;
}

export function SigningCard({
  output,
  onContinue,
  busy,
  signed = false,
  pinned = false,
  onSigned,
}: {
  output: SigningOutput;
  /** Sends a chat message so the agent proceeds to the next checkout step. */
  onContinue: (text: string) => void;
  busy: boolean;
  /**
   * Already signed, as recorded by the page. The card keeps its own `state` for the
   * instance that did the signing, but a card re-rendered later (the transcript copy,
   * once the pinned one is done) has no such state — without this it would offer to
   * sign an already-signed step.
   */
  signed?: boolean;
  /** Rendered in the pinned slot: drop the "come back to this card" instruction. */
  pinned?: boolean;
  /** Reports the signature so the page can stop pinning this step. */
  onSigned?: (key: string) => void;
}) {
  const { wallet } = useWallet();
  const [state, setState] = useState<"idle" | "signing" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const isLogin = output.step === "sign_login";
  const title = isLogin ? "Step 1 · Sign in as the buyer" : "Step 2 · Sign the payment";
  const explain = isLogin
    ? "A SIWE message proving you control the wallet — no funds move."
    : "The EIP-3009 authorization that lets the escrow pull the payment. Signing is free (gasless); funds move only into escrow.";

  const sign = async () => {
    if (!wallet) return;
    setState("signing");
    setError(null);
    try {
      const signature = isLogin
        ? await wallet.signMessage(output.siwe_message)
        : await wallet.signTypedData(output.signing_payload);
      // The AGENT's endpoint, not the merchant's (/api/shop). The signature is for
      // the buyer's own gateway session; the merchant has no part in it. (#6)
      const res = await fetch(`/api/checkout/${output.order_id}/signature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: isLogin ? "siwe" : "eip3009", signature }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `stash failed with ${res.status}`);
      }
      setState("done");
      onSigned?.(signingKey(output));
      onContinue(
        isLogin
          ? "I signed the login — continue the checkout."
          : "I signed the payment — submit it.",
      );
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="rounded-xl border border-blue-300 px-4 py-3 dark:border-blue-900">
      <div className="flex items-center gap-2">
        <span
          className={
            state === "done"
              ? "size-2 rounded-full bg-emerald-500"
              : "size-2 animate-pulse rounded-full bg-blue-500"
          }
        />
        <span className="text-xs font-semibold">{title}</span>
        <span className="ml-auto font-mono text-[11px] text-neutral-400">
          order #{output.order_id}
        </span>
      </div>
      <p className="mt-1 text-xs text-neutral-500">{explain}</p>
      {isLogin ? (
        <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-neutral-50 px-3 py-2 text-[10px] leading-relaxed text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
          {output.siwe_message}
        </pre>
      ) : (
        <p className="mt-2 font-mono text-[11px] text-neutral-500">
          rail0_id {output.rail0_id.slice(0, 10)}…{output.rail0_id.slice(-6)}
        </p>
      )}
      <div className="mt-3 flex items-center gap-3">
        {signed || state === "done" ? (
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
            Signed ✓ — the agent is picking it up
          </span>
        ) : wallet ? (
          <button
            type="button"
            disabled={state === "signing" || busy}
            onClick={sign}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-black"
          >
            {state === "signing"
              ? "Waiting for the wallet…"
              : wallet.kind === "metamask"
                ? "Sign with MetaMask"
                : "Sign with the pasted key"}
          </button>
        ) : (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            {pinned
              ? "Connect the buyer wallet just above to sign."
              : "Connect the buyer wallet in the bar at the top of the page, then come back to this card to sign."}
          </span>
        )}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    </div>
  );
}
