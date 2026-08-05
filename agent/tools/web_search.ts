import { disableTool } from "eve/tools";

// Provider-managed web search, disabled for the same reason as `web_fetch`: every remote
// read this agent needs goes through the storefront's own tools. It is only advertised when
// the model provider supports it, so this is a guard against the capability appearing on a
// provider change rather than something in use today.
export default disableTool();
