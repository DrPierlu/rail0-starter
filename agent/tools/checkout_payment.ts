import { defineTool } from "eve/tools";
import { z } from "zod";
import { createPaymentForOrder } from "../../src/lib/buyer";
import { shopBase } from "../lib/base";

export default defineTool({
  description:
    "Checkout step 2, only after the user confirmed they signed in: creates the " +
    "rail0 payment and returns the payment payload the user must sign next. " +
    "After calling this, STOP and wait for the user to sign in the card.",
  inputSchema: z.object({
    order_id: z.string().describe("The order id from checkout_begin."),
  }),
  async execute({ order_id }) {
    const { rail0_id, signing_payload, deposit_nonce } = await createPaymentForOrder(
      shopBase(),
      order_id,
    );
    // Same checkout, same nonce (minted at checkout_begin): this card deposits the
    // EIP-3009 signature and needs it too.
    return { step: "sign_payment", order_id, rail0_id, signing_payload, deposit_nonce };
  },
  // The card gets the full return; the model gets none of the material it could leak or
  // mangle. The EIP-712 payload must be signed VERBATIM, so routing it through model
  // context is both a disclosure risk and a corruption risk — a single altered hex digit
  // burns the payment. See checkout_begin for the full reasoning.
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        step: output.step,
        order_id: output.order_id,
        rail0_id: output.rail0_id,
        awaiting: "the user signs the payment card shown in chat",
      },
    };
  },
});
