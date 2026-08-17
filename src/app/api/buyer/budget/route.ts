import { NextResponse } from "next/server";
import { budgetPolicy, spentInWindow } from "@/lib/agent-budget";
import { errorResponse } from "@/lib/http";
import { listPaymentMethods } from "@/lib/shop";

/**
 * What the agent's wallet has spent in the current window, and its ceilings (#3).
 *
 * The whole answer to "how do you give an AI a payment method without giving it your
 * card": the agent has its own wallet, and the ceiling is enforced against the
 * GATEWAY's record of what that wallet has paid — see lib/agent-budget for why nothing
 * is counted locally. This route exists so the number can be SHOWN while it is
 * consumed, instead of living only in the approval hook nobody sees.
 *
 * Nothing secret here: the amounts are the agent's own payments, which the gateway
 * already scopes to that wallet, and the ceilings come from this deployment's own
 * configuration. No session gate for the same reason the buyer's order read has none.
 */
export async function GET() {
  try {
    const policy = budgetPolicy();
    // The first accepted method is enough: the ceiling is a policy of this deployment,
    // and the demo prices everything in one token.
    const [method] = await listPaymentMethods();
    if (!method) {
      return NextResponse.json({ configured: false, ...policy });
    }
    const spent = await spentInWindow({
      tokenAddress: method.address,
      chainId: method.chain_id,
      decimals: method.decimals,
      hours: policy.hours,
    });
    return NextResponse.json({
      configured: true,
      spent,
      symbol: method.symbol,
      chain_name: method.chain_name,
      ...policy,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
