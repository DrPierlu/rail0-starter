import { disableTool } from "eve/tools";

// Root-only delegation, disabled — and not only as surface reduction.
//
// "Every subagent starts with its own fresh state… `defineState` values never cross the
// parent/child boundary, even when the child is a copy of the same agent"
// (docs/guides/state.md). The cart and the remembered orders ARE defineState, so a
// delegated copy calling add_to_cart would write a cart nobody reads, and report success.
export default disableTool();
