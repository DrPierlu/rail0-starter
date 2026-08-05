import { disableTool } from "eve/tools";

// Arbitrary URL fetching, disabled. Every remote read this agent needs goes through the
// storefront's own tools, which are the only endpoints that know the merchant's catalog
// and the gateway. Left enabled it is an exfiltration path out of a session that holds a
// checkout capability.
export default disableTool();
