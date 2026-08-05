import { describe, expect, it } from "vitest";
import { walletErrorMessage } from "@/app/buyer/wallet";

// The bug this pins: `err instanceof Error ? err.message : String(err)` is wrong for a
// wallet. An EIP-1193 rejection is a ProviderRpcError, and MetaMask's injected proxy
// delivers it as a PLAIN OBJECT — so the ternary fell through to String(err) and the
// signing card rendered the literal text "[object Object]" next to "Sign with
// MetaMask", which is where declining the prompt lands.
describe("walletErrorMessage", () => {
  it("never renders [object Object] for a provider rejection", () => {
    // Exactly what MetaMask rejects with: a POJO, not an Error.
    const rejection = { code: 4001, message: "MetaMask Tx Signature: User denied…" };
    expect(walletErrorMessage(rejection)).not.toContain("[object Object]");
  });

  it("gives the two codes a user actually hits their own wording", () => {
    expect(walletErrorMessage({ code: 4001, message: "User denied…" })).toBe(
      "you declined the request in the wallet",
    );
    expect(walletErrorMessage({ code: -32002, message: "Already processing" })).toContain(
      "already has a request open",
    );
  });

  it("keeps the provider's own message when it is more specific than ours", () => {
    expect(walletErrorMessage({ code: 4200, message: "Unsupported method" })).toBe(
      "Unsupported method",
    );
  });

  it("still says something useful for a code with no message", () => {
    expect(walletErrorMessage({ code: 4900 })).toBe("the wallet refused the request (code 4900)");
  });

  it("passes a real Error through unchanged", () => {
    expect(walletErrorMessage(new Error("MetaMask is not available"))).toBe(
      "MetaMask is not available",
    );
  });

  it("falls back rather than stringifying something unrecognisable", () => {
    // An empty object, null, undefined: all used to become "[object Object]" or
    // "undefined" on screen.
    for (const bad of [{}, null, undefined, 42]) {
      expect(walletErrorMessage(bad)).toBe("the wallet request failed");
    }
  });
});
