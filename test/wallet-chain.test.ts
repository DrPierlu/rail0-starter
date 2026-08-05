import { describe, expect, it, vi } from "vitest";
import { ensureChain } from "@/app/buyer/wallet";

// The bug this pins: eth_signTypedData_v4 refuses a payload whose domain names a
// different chain than the wallet is on — "Provided chainId 5042002 must match the
// active chainId 80002". Nothing asked MetaMask to switch, so a buyer whose wallet sat
// on another network could not pay at all, and the only clue was that raw message.

/** A provider stub that reports `active` and records what was requested of it. */
function fakeProvider(active: number, onSwitch?: () => never) {
  const calls: Array<{ method: string; params?: unknown[] }> = [];
  return {
    calls,
    provider: {
      request: vi.fn(async (args: { method: string; params?: unknown[] }) => {
        calls.push(args);
        if (args.method === "eth_chainId") return `0x${active.toString(16)}`;
        if (args.method === "wallet_switchEthereumChain" && onSwitch) onSwitch();
        return null;
      }),
    },
  };
}

describe("ensureChain", () => {
  it("switches MetaMask to the chain the payload names", async () => {
    const { provider, calls } = fakeProvider(80002); // Polygon Amoy
    await ensureChain(provider, 5042002); // Arc

    const sw = calls.find((c) => c.method === "wallet_switchEthereumChain");
    expect(sw).toBeDefined();
    // Hex, as EIP-3326 requires — a decimal chainId is silently rejected.
    // 0x4cef52 === 5042002, verified independently rather than eyeballed.
    expect(sw?.params).toEqual([{ chainId: "0x4cef52" }]);
  });

  it("does nothing when the wallet is already on that chain", async () => {
    const { provider, calls } = fakeProvider(5042002);
    await ensureChain(provider, 5042002);

    expect(calls.map((c) => c.method)).toEqual(["eth_chainId"]);
  });

  it("says nothing to do when the payload names no chain", async () => {
    const { provider, calls } = fakeProvider(80002);
    await ensureChain(provider, undefined);

    expect(calls).toHaveLength(0);
  });

  // 4902 = MetaMask has no such network. It cannot be added for the user:
  // wallet_addEthereumChain needs rpcUrls, and the gateway exposes those only on the
  // HMAC-protected /sync/blockchains. So it must become an instruction.
  it("turns an unknown network into an actionable instruction", async () => {
    const { provider } = fakeProvider(80002, () => {
      throw { code: 4902, message: "Unrecognized chain ID" };
    });

    await expect(ensureChain(provider, 5042002)).rejects.toThrow(/Add it in MetaMask/);
    await expect(ensureChain(provider, 5042002)).rejects.toThrow(/5042002/);
  });

  // Anything else — 4001 above all — must reach the caller untouched, so
  // walletErrorMessage can word it.
  it("rethrows every other rejection for the caller to word", async () => {
    const { provider } = fakeProvider(80002, () => {
      throw { code: 4001, message: "User rejected the request." };
    });

    await expect(ensureChain(provider, 5042002)).rejects.toMatchObject({ code: 4001 });
  });
});
