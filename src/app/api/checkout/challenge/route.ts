import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { siweChallenge } from "@/lib/buyer";
import { errorResponse } from "@/lib/http";

/**
 * The exact text the connected wallet must sign to start a checkout.
 *
 * It exists so the ADDRESS never has to travel through the agent. It used to: the tool
 * took a `buyer_address`, which the model was told to copy from the client context — and
 * a model that does not copy it produces "no wallet connected — ask the shopper to
 * connect one" for a shopper whose wallet is connected and visible on screen. The
 * address is a fact the browser holds; asking a language model to relay it was the bug.
 *
 * Built server-side because the nonce is the gateway's, and fetched per attempt rather
 * than per card: SIWE nonces are single-use and a card that sat open through a few
 * retries would otherwise sign a spent one.
 *
 * POST, not GET with a query: a wallet address is the buyer's identity on-chain, and
 * identity does not belong in a URL that ends up in logs and history.
 */
const schema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, {
    message: "address must be a 0x-prefixed 20-byte address",
  }),
});

export async function POST(request: NextRequest) {
  try {
    const { address } = schema.parse(await request.json());
    return NextResponse.json({ siwe_message: await siweChallenge(address) });
  } catch (error) {
    return errorResponse(error);
  }
}
