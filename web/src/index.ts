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
export { RecordForm } from "./boards/RecordForm.js";
export { BoardView } from "./boards/BoardView.js";
export { Designer } from "./boards/Designer.js";
export { CopMap } from "./cop/CopMap.js";
export * from "./cop/symbology.js";
export * from "./cop/layers.js";
export * from "./cop/feeds.js";
export { Dashboard } from "./dashboards/Dashboard.js";
export { BriefingView } from "./sitreps/BriefingView.js";
export { openOfflineStore, type OfflineStore } from "./offline/store.js";
export {
  FieldClient,
  type FieldSession,
  type CachedBoard,
  type SyncAck,
  type PushFn,
} from "./offline/field-client.js";
export { registerFieldWorker } from "./offline/register.js";
