import { defineTool } from "eve/tools";
import { z } from "zod";
import { getProduct } from "../../src/lib/catalog";
import { addToCart } from "../../src/lib/store";

export default defineTool({
  description: "Add a product (by id from list_products) to the cart.",
  inputSchema: z.object({
    product_id: z.string(),
    qty: z.number().int().positive().default(1),
  }),
  async execute({ product_id, qty }) {
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
});
