import { defineTool } from "eve/tools";
import { z } from "zod";
import { getShop } from "../../src/lib/buyer";
import { shopBase } from "../lib/base";

export default defineTool({
  description:
    "List the merchant's products, optionally filtered by category or free-text search. " +
    "The catalog is written in ENGLISH: translate the shopper's words before searching, " +
    "whatever language they are speaking. Searching in another language finds nothing. " +
    "Only the first two dozen matches come back — `total` says how many there were, and " +
    "a category or a search is how you see the rest.",
  inputSchema: z.object({
    category: z
      .string()
      .optional()
      .describe(
        "Exact category, e.g. 'T-Shirts'. Omit both fields to list everything — the " +
          "result carries the full set of categories.",
      ),
    search: z
      .string()
      .optional()
      .describe(
        "English keywords, matched against name, description and category. Prefer one or " +
          "two plain nouns ('tee', 'hoodie') over a phrase: matching is per word, so extra " +
          "words only widen the result. Omit it entirely to list everything.",
      ),
  }),
  execute: (input) => getShop(shopBase()).products(input),
});
