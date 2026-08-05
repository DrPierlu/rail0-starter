import { disableTool } from "eve/tools";

// This agent browses a catalog and runs a checkout. It has no business running shell
// commands, and the default harness advertises `bash` unless told otherwise — a sandbox
// "exists by default, with nothing to author" (docs/sandbox.mdx), so the capability was
// live. The docs are imperative about reviewing this: "Disable, wrap, restrict, or require
// approval for any tool that can access the filesystem, network, shell, or sensitive
// data" (docs/concepts/default-harness.md).
//
// It matters more than surface-area tidiness here: the session's context carries a live
// checkout capability (the deposit nonce) and the shopper's wallet address.
export default disableTool();
