/**
 * @openeoc/shared
 * Schemas and types shared by the server and web packages.
 */

export * from "./dictionary/index.js";
export * from "./boards/fields.js";
export * from "./boards/standard.js";
export * from "./boards/view.js";
export * from "./boards/diff.js";
export * from "./dashboards/def.js";
export * from "./sitreps/def.js";
export * from "./forms/expr.js";
export * from "./forms/xlsform.js";
export * from "./forms/runner.js";
export * from "./damage/summary.js";
export * from "./cap/model.js";
export * from "./cap/validate.js";
export * from "./cap/xml.js";
export * from "./edxl/edxl.js";

export const OPENEOC_VERSION = "0.0.0" as const;

export interface WorkspaceInfo {
  readonly name: string;
  readonly version: typeof OPENEOC_VERSION;
}

export function workspaceInfo(name: string): WorkspaceInfo {
  return { name, version: OPENEOC_VERSION };
}
