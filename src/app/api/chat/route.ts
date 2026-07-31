import { anthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";
import { getShop, placeAndPayOrder } from "@/lib/buyer";
import { getProduct } from "@/lib/catalog";
import { env } from "@/lib/env";
import { addressFor } from "@/lib/rail0";
import { addToCart, clearCart, getCart, removeFromCart } from "@/lib/store";

export const maxDuration = 60;

const SYSTEM = `You are a shopping assistant that buys physical goods from a single
merchant's catalog on the user's behalf, paying in stablecoins over rail0 escrow.

Rules:
- ALWAYS ask the user to confirm before checking out: show the cart lines, the
  total, and the chosen chain + stablecoin, and wait for an explicit yes.
- Payments use rail0's authorize (escrow) mode: at checkout the buyer's funds are
  locked on-chain in escrow; the merchant only receives them when it captures the
  payment after fulfilment. Explain this briefly when relevant.
- After checkout, the escrow confirms on-chain in a few seconds: check order_status
  before declaring the order in escrow.
- Amounts in the catalog are stablecoin prices (e.g. USDC). Never invent products,
  prices, or payment methods — always read them through the tools.`;

export const POST = async (request: Request) => {
  const { messages }: { messages: UIMessage[] } = await request.json();

  const shop = getShop();

  const result = streamText({
    model: anthropic(env().AI_MODEL),
    system: SYSTEM,
    messages: convertToModelMessages(messages),
    stopWhen: stepCountIs(10),
    // A checkout can be several tool round-trips deep when the model 529s, and
    // losing the turn means the user retypes the confirmation. Worth a couple
    // more attempts than the SDK's default 2.
    maxRetries: 4,
    tools: {
      list_products: tool({
        description:
          "List the merchant's products, optionally filtered by category or free-text search.",
        inputSchema: z.object({
          category: z.string().optional(),
          search: z.string().optional(),
        }),
        execute: (args) => shop.products(args),
      }),
      payment_options: tool({
        description:
          "List the chain + stablecoin pairs the merchant accepts (from the rail0 gateway).",
        inputSchema: z.object({}),
        execute: () => shop.paymentMethods(),
      }),
      add_to_cart: tool({
        description: "Add a product (by id from list_products) to the cart.",
        inputSchema: z.object({
          product_id: z.string(),
          qty: z.number().int().positive().default(1),
        }),
        execute: async ({ product_id, qty }) => {
          const product = getProduct(product_id);
          if (!product) return { error: `unknown product: ${product_id}` };
          return {
            cart: await addToCart({
              product_id: product.id,
              name: product.name,
              price: product.price,
              qty,
            }),
          };
        },
      }),
      view_cart: tool({
        description: "Show the current cart contents.",
        inputSchema: z.object({}),
        execute: async () => ({ cart: await getCart() }),
      }),
      remove_from_cart: tool({
        description: "Remove a product from the cart (all of it, or just `qty` units).",
        inputSchema: z.object({
          product_id: z.string(),
          qty: z.number().int().positive().optional(),
        }),
        execute: async ({ product_id, qty }) => ({
          cart: await removeFromCart(product_id, qty),
        }),
      }),
      clear_cart: tool({
        description: "Empty the cart entirely.",
        inputSchema: z.object({}),
        execute: async () => {
          await clearCart();
          return { cart: [] };
        },
      }),
      checkout: tool({
        description:
          "Place the order for the current cart and pay it over rail0 escrow. " +
          "Only call after the user explicitly confirmed cart, total, chain and token.",
        inputSchema: z.object({
          chain_id: z.number().int().describe("Chosen chain id, from payment_options."),
          token_address: z
            .string()
            .describe("Chosen stablecoin's contract address, from payment_options."),
        }),
        execute: async ({ chain_id, token_address }) => {
          const cart = await getCart();
          if (cart.length === 0) return { error: "cart is empty" };
          const { order, rail0_id } = await placeAndPayOrder(
            cart.map((l) => ({ product_id: l.product_id, qty: l.qty })),
            chain_id,
            token_address,
          );
          await clearCart();
          return {
            order_id: order.id,
            state: order.state,
            total: order.total,
            token: order.token.symbol,
            rail0_id,
            payer: addressFor("buyer"),
          };
        },
      }),
      order_status: tool({
        description: "Fetch an order's current state (refreshes the on-chain payment status).",
        inputSchema: z.object({
          order_id: z.string().describe("The order id (or its rail0_id)."),
        }),
        execute: async ({ order_id }) => shop.order(order_id),
      }),
      my_orders: tool({
        description: "List all orders, newest first, with their current state.",
        inputSchema: z.object({}),
        execute: () => shop.orders(),
      }),
    },
  });

  return result.toUIMessageStreamResponse({ sendReasoning: true, onError: chatErrorMessage });
};

/**
 * The AI SDK swallows stream errors into a generic "An error occurred." unless
 * onError maps them, which left the chat silently dead on the most common
 * failure by far: a 529 from the model provider (upstream overload, retried and
 * given up on — nothing wrong with this app). Name that case, and pass anything
 * else through so tool/gateway failures are debuggable in the UI.
 */
function chatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/overloaded|\b529\b/i.test(message)) {
    return "The model is overloaded right now — retry in a moment.";
  }
  return message;
}
