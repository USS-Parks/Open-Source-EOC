import { MessagesWorkspace, type MessagesWorkspaceProps } from "../../coordination/MessagesWorkspace.js";

/** D27 presentation over the existing append-only messaging engine. */
export function MessagesSurface(props: MessagesWorkspaceProps) {
  return <MessagesWorkspace {...props} />;
}