/**
 * @openeoc/shared
 * Schemas and types shared by the server and web packages.
 */

export * from "./dictionary/index.js";
export * from "./boards/fields.js";
export * from "./boards/standard.js";

export const OPENEOC_VERSION = "0.0.0" as const;

export interface WorkspaceInfo {
  readonly name: string;
  readonly version: typeof OPENEOC_VERSION;
}

export function workspaceInfo(name: string): WorkspaceInfo {
  return { name, version: OPENEOC_VERSION };
}
