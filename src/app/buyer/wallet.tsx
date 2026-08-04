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
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

// The buyer's wallet, browser-side only. Two backends, mirroring rail0-admin:
// MetaMask (the key stays in the extension) or a pasted private key (kept in
// React state for the tab's lifetime — never persisted, never sent anywhere;
// only the SIGNATURES it produces leave the browser).

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  /** EIP-1193 events. Optional: not every injected provider implements them. */
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
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
  /** Re-open MetaMask's account picker to hand over to a different account. */
  switchMetaMask(): Promise<void>;
  connectPrivateKey(key: string): void;
  disconnect(): Promise<void>;
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
  // Detected after mount, not during render: `typeof window !== "undefined"` is false
  // on the server and true on the client, which is a hydration mismatch by
  // construction (React lists it first among the causes). Server and first client
  // render now agree on false, and the effect flips it.
  const [hasMetaMask, setHasMetaMask] = useState(false);
  useEffect(() => setHasMetaMask(!!window.ethereum), []);

  // One place that turns an address into a MetaMask-backed Wallet — used by the
  // initial connect, by the account switch, and by the accountsChanged handler, so
  // all three produce an identical object rather than three near-copies.
  const metaMaskWallet = useCallback((rawAddress: string): Wallet => {
    const address = toChecksumAddress(rawAddress);
    return {
      kind: "metamask",
      address,
      signMessage: async (message) => {
        const ethereum = window.ethereum;
        if (!ethereum) throw new Error("MetaMask is not available");
        return (await ethereum.request({
          method: "personal_sign",
          params: [message, address],
        })) as string;
      },
      signTypedData: async (payload) => {
        const ethereum = window.ethereum;
        if (!ethereum) throw new Error("MetaMask is not available");
        return (await ethereum.request({
          method: "eth_signTypedData_v4",
          params: [address, JSON.stringify(payload)],
        })) as string;
      },
    };
  }, []);

  const connectMetaMask = useCallback(async () => {
    const ethereum = window.ethereum;
    if (!ethereum) throw new Error("MetaMask is not available");
    const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts?.[0]) throw new Error("no account returned by the wallet");
    setWallet(metaMaskWallet(accounts[0]));
  }, [metaMaskWallet]);

  // Hand over to a DIFFERENT account. eth_requestAccounts cannot do this: once an
  // account is permitted it resolves silently with that same one, so "disconnect then
  // connect" put you back where you were. wallet_requestPermissions (EIP-2255) re-opens
  // MetaMask's account picker, which is the only way to let the user choose.
  const switchMetaMask = useCallback(async () => {
    const ethereum = window.ethereum;
    if (!ethereum) throw new Error("MetaMask is not available");
    await ethereum.request({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }],
    });
    const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts?.[0]) throw new Error("no account returned by the wallet");
    setWallet(metaMaskWallet(accounts[0]));
  }, [metaMaskWallet]);

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

  // Forgetting the wallet locally is not disconnecting: MetaMask keeps the account
  // permitted, so the next connect resolves silently with it and there is no way to
  // pick another. Revoking the eth_accounts permission (EIP-2255) makes the next
  // connect prompt properly.
  //
  // Best-effort: a provider that does not implement wallet_revokePermissions throws,
  // and the local state must still be cleared — refusing to disconnect because the
  // wallet would not cooperate is the wrong failure. The pasted-key case has nothing
  // to revoke.
  const disconnect = useCallback(async () => {
    const ethereum = window.ethereum;
    if (wallet?.kind === "metamask" && ethereum) {
      try {
        await ethereum.request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }],
        });
      } catch {
        // Older or non-MetaMask providers: nothing to do but forget it here.
      }
    }
    setWallet(null);
  }, [wallet]);

  // Follow the wallet when the user switches account (or disconnects the site) from
  // inside MetaMask, instead of holding an address the extension no longer controls —
  // which would only surface as a confusing signature failure at checkout. An empty
  // array is MetaMask saying the site is no longer permitted.
  //
  // Only while a MetaMask wallet is connected: a pasted key is unrelated to the
  // extension and must not be cleared by its events.
  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum?.on || wallet?.kind !== "metamask") return;
    const onAccountsChanged = (...args: never[]) => {
      const accounts = args[0] as unknown as string[] | undefined;
      if (!accounts?.length) {
        setWallet(null);
        return;
      }
      setWallet(metaMaskWallet(accounts[0]));
    };
    ethereum.on("accountsChanged", onAccountsChanged);
    return () => ethereum.removeListener?.("accountsChanged", onAccountsChanged);
  }, [wallet?.kind, metaMaskWallet]);

  const value = useMemo(
    () => ({ wallet, hasMetaMask, connectMetaMask, switchMetaMask, connectPrivateKey, disconnect }),
    [wallet, hasMetaMask, connectMetaMask, switchMetaMask, connectPrivateKey, disconnect],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

/** Header chip: connect MetaMask or paste a key; shows the connected address. */
export function WalletChip() {
  const { wallet, hasMetaMask, connectMetaMask, switchMetaMask, connectPrivateKey, disconnect } =
    useWallet();
  const [pasting, setPasting] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Both actions talk to the extension and can be refused (the user closes the
  // MetaMask prompt), so they report rather than fail silently, and the buttons are
  // locked while one is open — a second click would queue another prompt.
  const run = (action: () => Promise<void>) => () => {
    setBusy(true);
    setError(null);
    action()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  if (wallet) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
        {error && <span className="text-red-500">{error}</span>}
        <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 font-mono text-emerald-700 dark:text-emerald-400">
          {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
        </span>
        <span className="text-neutral-400">{wallet.kind === "metamask" ? "MetaMask" : "key"}</span>
        {wallet.kind === "metamask" && (
          <button
            type="button"
            onClick={run(switchMetaMask)}
            disabled={busy}
            title="Choose a different MetaMask account"
            className="text-neutral-400 hover:underline disabled:opacity-50"
          >
            switch
          </button>
        )}
        <button
          type="button"
          onClick={run(disconnect)}
          disabled={busy}
          title={
            wallet.kind === "metamask"
              ? "Forget this wallet and revoke the site's access, so the next connect lets you pick another"
              : "Forget this key (it was only ever in this tab)"
          }
          className="text-neutral-400 hover:underline disabled:opacity-50"
        >
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
              onClick={run(connectMetaMask)}
              disabled={busy}
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
