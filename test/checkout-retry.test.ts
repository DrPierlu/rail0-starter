import { Rail0ApiError } from "@rail0/sdk";
import { describe, expect, it } from "vitest";
import { isAlreadySigned } from "@/lib/buyer";

// The bug this guards: checkout step 3 signed unconditionally. When the sign
// succeeded and the attach after it did not, the order stayed awaiting_payment,
// so every retry re-signed, took 422 already_signed, and died BEFORE the attach —
// a signed payment on a permanently stuck order. Step 3 now skips the signing when
// the payment says it already happened, and tolerates this one code for the race.

const apiError = (status: number, body: { status: string; code?: string; error?: string }) =>
  new Rail0ApiError(status, body);

describe("isAlreadySigned", () => {
  it("recognises the gateway's already_signed refusal", () => {
    expect(
      isAlreadySigned(apiError(422, { status: "invalid_state", code: "already_signed" })),
    ).toBe(true);
  });

  // Older gateways send the specific sub-code as `error`; the SDK folds both into
  // Rail0ApiError.error, and a retry must be safe against either.
  it("recognises it under the older sub-code name", () => {
    expect(
      isAlreadySigned(apiError(422, { status: "invalid_state", error: "already_signed" })),
    ).toBe(true);
  });

  it("does not swallow other gateway failures", () => {
    for (const code of ["invalid_token_signature", "signer_mismatch", "not_payer", "not_found"]) {
      expect(isAlreadySigned(apiError(422, { status: "invalid_state", code }))).toBe(false);
    }
  });

  it("does not swallow non-API errors", () => {
    expect(isAlreadySigned(new Error("already_signed"))).toBe(false);
    expect(isAlreadySigned(undefined)).toBe(false);
  });
});
