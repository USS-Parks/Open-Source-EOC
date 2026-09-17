/**
 * @openeoc/web
 * React front end.
 */

import { workspaceInfo } from "@openeoc/shared";

export const webInfo = workspaceInfo("@openeoc/web");

export * from "./design/tokens.js";
export * from "./design/components.js";
export * from "./design/layout.js";
export { Gallery } from "./design/gallery.js";
