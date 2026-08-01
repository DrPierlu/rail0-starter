import { anthropic } from "@ai-sdk/anthropic";
import { defineAgent } from "eve";

// Direct provider model (not an AI Gateway id) so local dev needs only
// ANTHROPIC_API_KEY, exactly like the AI SDK variant on main. process.env is
// read directly rather than through src/lib/env: that schema demands the
// signing keys too, and the model choice shouldn't fail on an unrelated var.
export default defineAgent({
  model: anthropic(process.env.AI_MODEL || "claude-sonnet-5"),
});
