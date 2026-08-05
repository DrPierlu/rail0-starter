import { disableTool } from "eve/tools";

// Sandbox filesystem access, disabled for the same reason as `bash`: a commerce agent
// reads its catalog through `list_products`, never off a disk.
export default disableTool();
