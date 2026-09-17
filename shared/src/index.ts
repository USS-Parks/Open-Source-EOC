/**
 * @openeoc/shared
 * Schemas and types shared by the server and web packages.
 * The domain data dictionary lands here in roster session VEOC-03.
 */

export const OPENEOC_VERSION = "0.0.0" as const;

export interface WorkspaceInfo {
  readonly name: string;
  readonly version: typeof OPENEOC_VERSION;
}

export function workspaceInfo(name: string): WorkspaceInfo {
  return { name, version: OPENEOC_VERSION };
}
