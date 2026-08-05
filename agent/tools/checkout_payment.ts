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
});
