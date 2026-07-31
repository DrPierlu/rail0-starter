"use client";

import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  checksumAddress,
  type Eip3009Signature,
  type PaymentDetail,
  personalSign,
  type SigningPayload,
  signPayment,
} from "@rail0/sdk";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

// The buyer's wallet, browser-side only. Two backends, mirroring rail0-admin:
// MetaMask (the key stays in the extension) or a pasted private key (kept in
// React state for the tab's lifetime — never persisted, never sent anywhere;
// only the SIGNATURES it produces leave the browser).

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export interface Wallet {
  kind: "metamask" | "privateKey";
  /** EIP-55 checksummed — the gateway's SIWE parser rejects lowercase. */
  address: string;
  signMessage(message: string): Promise<string>;
  signTypedData(payload: SigningPayload): Promise<string>;
}

interface WalletContextValue {
  wallet: Wallet | null;
  hasMetaMask: boolean;
  connectMetaMask(): Promise<void>;
  connectPrivateKey(key: string): void;
  disconnect(): void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet outside WalletProvider");
  return ctx;
}

/** EIP-55 checksum of a plain address (MetaMask hands addresses back lowercase). */
export function toChecksumAddress(address: string): string {
  const addr = address.toLowerCase().replace(/^0x/, "");
  const hashHex = Array.from(keccak_256(new TextEncoder().encode(addr)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  let out = "0x";
  for (let i = 0; i < addr.length; i++) {
    out += Number.parseInt(hashHex[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i];
  }
  return out;
}

/** Pack { v, r, s } into the 65-byte r||s||v hex the gateway expects. */
function pack(sig: Eip3009Signature): string {
  return `${sig.r}${sig.s.slice(2)}${sig.v.toString(16).padStart(2, "0")}`;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const hasMetaMask = typeof window !== "undefined" && !!window.ethereum;

  const connectMetaMask = useCallback(async () => {
    const ethereum = window.ethereum;
    if (!ethereum) throw new Error("MetaMask is not available");
    const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts?.[0]) throw new Error("no account returned by the wallet");
    const address = toChecksumAddress(accounts[0]);
    setWallet({
      kind: "metamask",
      address,
      signMessage: async (message) =>
        (await ethereum.request({
          method: "personal_sign",
          params: [message, address],
        })) as string,
      signTypedData: async (payload) =>
        (await ethereum.request({
          method: "eth_signTypedData_v4",
          params: [address, JSON.stringify(payload)],
        })) as string,
    });
  }, []);

  const connectPrivateKey = useCallback((key: string) => {
    const trimmed = key.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
      throw new Error("the key must be a 0x-prefixed 32-byte hex string");
    }
    setWallet({
      kind: "privateKey",
      address: checksumAddress(trimmed),
      signMessage: async (message) => personalSign(trimmed, message),
      // signPayment only reads `signing_payload`, so a minimal object is enough
      // (the same trick rail0-admin uses for signRefund).
      signTypedData: async (payload) =>
        pack(signPayment(trimmed as `0x${string}`, { signing_payload: payload } as PaymentDetail)),
    });
  }, []);

  const disconnect = useCallback(() => setWallet(null), []);

  const value = useMemo(
    () => ({ wallet, hasMetaMask, connectMetaMask, connectPrivateKey, disconnect }),
    [wallet, hasMetaMask, connectMetaMask, connectPrivateKey, disconnect],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

/** Header chip: connect MetaMask or paste a key; shows the connected address. */
export function WalletChip() {
  const { wallet, hasMetaMask, connectMetaMask, connectPrivateKey, disconnect } = useWallet();
  const [pasting, setPasting] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (wallet) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 font-mono text-emerald-700 dark:text-emerald-400">
          {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
        </span>
        <span className="text-neutral-400">{wallet.kind === "metamask" ? "MetaMask" : "key"}</span>
        <button type="button" onClick={disconnect} className="text-neutral-400 hover:underline">
          disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
      {error && <span className="text-red-500">{error}</span>}
      {pasting ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              connectPrivateKey(key);
              setKey("");
              setPasting(false);
              setError(null);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="0x… private key (stays in this tab)"
            className="w-64 rounded-lg border border-neutral-300 bg-transparent px-2 py-1 font-mono outline-none focus:border-neutral-500 dark:border-neutral-700"
          />
          <button
            type="submit"
            className="rounded-lg bg-neutral-900 px-2.5 py-1 font-medium text-white dark:bg-neutral-100 dark:text-black"
          >
            Use key
          </button>
          <button
            type="button"
            onClick={() => setPasting(false)}
            className="text-neutral-400 hover:underline"
          >
            cancel
          </button>
        </form>
      ) : (
        <>
          <span className="text-neutral-400">buyer wallet:</span>
          {hasMetaMask && (
            <button
              type="button"
              onClick={() => connectMetaMask().catch((e) => setError(e.message))}
              className="rounded-lg bg-neutral-900 px-2.5 py-1 font-medium text-white dark:bg-neutral-100 dark:text-black"
            >
              Connect MetaMask
            </button>
          )}
          <button
            type="button"
            onClick={() => setPasting(true)}
            className="rounded-lg border border-neutral-300 px-2.5 py-1 font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            Paste a key
          </button>
        </>
      )}
    </div>
  );
}
