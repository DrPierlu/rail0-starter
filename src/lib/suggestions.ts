/**
 * The prompt chips offered on an empty buyer chat.
 *
 * The pool is deliberately wider than the row that shows it: four are drawn at
 * random each time the chat mounts, so a demo shown twice does not open with the
 * same four prompts, and a visitor who reloads (or starts a new conversation)
 * sees a different slice of what the agent can do.
 *
 * Two constraints on anything added here, because a chip that leads to "I can't
 * do that" is worse than no chip at all:
 *
 *   Answerable with the tools the agent actually has — list_products,
 *   add_to_cart / view_cart, payment_options, my_orders, order_status.
 *
 *   Truthful about catalog.json. The prices below sit inside the catalog's real
 *   range (1.01 to 9.91) and name categories it really carries, so a
 *   price-bounded or category-bounded chip never comes back empty.
 */
export const SUGGESTIONS: readonly string[] = [
  // Browsing — the widest opening, and the one that shows the catalog exists.
  "What's in the store?",
  "What categories do you carry?",
  "What's the cheapest thing you sell?",
  // Bounded searches. Every bound here has matches in catalog.json.
  "Find me a t-shirt under $3",
  "I need a hoodie under $5",
  "Show me the jackets",
  "What jeans do you have?",
  "Something warm for under $10",
  // Cart building — the step between browsing and checkout.
  "Put together an outfit under $20",
  "Add a beanie and a pair of socks to my cart",
  "What's in my cart?",
  // Payment and escrow: the point of the demo, asked in the shopper's words.
  "How can I pay?",
  "Which chains and tokens can I pay with?",
  "What happens to my money while it's in escrow?",
  // After the purchase.
  "Show my orders",
  "What's the status of my last order?",
];

/**
 * `n` distinct suggestions drawn uniformly at random, in random order.
 *
 * Fisher-Yates over a copy rather than the familiar `sort(() => Math.random() -
 * 0.5)`: that one-liner is measurably biased (the comparator is inconsistent, so
 * the result depends on the engine's sort), and with a pool this small the bias
 * is visible — some prompts would surface far more often than others, which is
 * exactly what this function exists to avoid.
 *
 * Shuffling only the first `n` positions is enough: after `n` swaps the prefix is
 * already a uniform sample without replacement, and the rest is discarded. Asking
 * for more than the pool holds returns the whole pool, shuffled.
 */
export function pickSuggestions(n = 4, pool: readonly string[] = SUGGESTIONS): string[] {
  const items = [...pool];
  const count = Math.min(n, items.length);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(Math.random() * (items.length - i));
    [items[i], items[j]] = [items[j] as string, items[i] as string];
  }
  return items.slice(0, count);
}
