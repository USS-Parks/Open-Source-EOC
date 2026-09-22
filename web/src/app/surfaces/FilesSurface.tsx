import { FilesWorkspace, type FilesWorkspaceProps } from "../../coordination/FilesWorkspace.js";

/** D27 presentation over the existing content-addressed file engine. */
export function FilesSurface(props: FilesWorkspaceProps) {
  return <FilesWorkspace {...props} />;
}