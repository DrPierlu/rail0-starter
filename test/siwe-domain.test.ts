import { describe, expect, it } from "vitest";

// The gateway's SIWE binding check (auth_service.rb) raises SignerMismatch for FIVE
// different reasons, only one of which is a bad signature — and the 422 that reaches the
// client reads like a signature problem either way. Two of the other four fire when the
// message's domain carries a port:
//
//   allowed_domains.include?(parsed.domain)   # allow-list holds bare hosts
//   uri_host == parsed.domain                 # a URI host never has the port
//
// So the domain must be the hostname. This pins the derivation, because the failure it
// prevents was diagnosed as a wallet problem for an hour: the signatures were valid the
// whole time (recovered signer == claimed address).
const siweDomain = (gatewayUrl: string) => new URL(gatewayUrl).hostname;
const uriHost = (gatewayUrl: string) => new URL(gatewayUrl).host;

describe("SIWE domain derivation", () => {
  it("drops the port, which URL.host would keep", () => {
    expect(siweDomain("http://localhost:9292")).toBe("localhost");
    expect(uriHost("http://localhost:9292")).toBe("localhost:9292");
  });

  it("matches what the gateway compares the URI host against", () => {
    for (const gateway of [
      "http://localhost:9292",
      "https://api.rail0.xyz",
      "https://rail0-gateway-staging.fly.dev",
      "http://127.0.0.1:9292",
    ]) {
      // The gateway does `URI.parse(uri).host == parsed.domain`, and Ruby's URI#host
      // excludes the port — so the domain has to equal the portless host.
      expect(siweDomain(gateway)).toBe(new URL(gateway).hostname);
      expect(siweDomain(gateway)).not.toContain(":");
    }
  });

  it("is unchanged for a gateway on the default port", () => {
    expect(siweDomain("https://api.rail0.xyz")).toBe("api.rail0.xyz");
  });
});
