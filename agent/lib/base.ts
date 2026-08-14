// The storefront's base URL, defined in src/lib/shop-base — the checkout routes need
// the same rule the tools do, and two copies of it could point at two applications.
// Re-exported here so the agent's tools keep importing it from their own lib.
export { LOCAL_SHOP_PORT, shopBase } from "../../src/lib/shop-base";
