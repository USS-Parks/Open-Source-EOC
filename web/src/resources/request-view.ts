import { RESOURCE_REQUEST_ENDED, RESOURCE_REQUEST_STAGES, requestStage, type ResourceRequestSummary } from "@openeoc/shared";

/** How a request's stage reads at a glance: waiting on someone, moving, done, or ended without delivery. */
export function stageTone(state: string): "warning" | "info" | "success" | "unknown" {
  if (state === "closed" || state === "fulfilled") return "success";
  if (state === "declined" || state === "cancelled") return "unknown";
  if (state === "submitted" || state === "draft") return "warning";
  return "info";
}

export { requestStage };

/** Clock time with the day when it is not today. */
export function when(iso: string): string {
  const at = new Date(iso);
  const today = at.toDateString() === new Date().toDateString();
  return at.toLocaleString([], today
    ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
    : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** Who owns the request's next action: the assignee, else whoever accepted it, else no one yet. */
export function ownerLabel(request: ResourceRequestSummary): string {
  const { assignment, acceptance } = request;
  if (assignment?.kind === "position") return `${assignment.positionTitle} · ${assignment.organization.name}`;
  if (assignment) return `${assignment.personName} · ${assignment.incidentPositionTitle} · ${assignment.organization.name}`;
  if (RESOURCE_REQUEST_ENDED.includes(request.state)) return "No one: the request has ended";
  if (acceptance) return `${acceptance.personName}${acceptance.positionTitle ? `, ${acceptance.positionTitle}` : ""} · ${request.receivingOrganization.name}`;
  return `No one yet · ${request.receivingOrganization.name} has not accepted it`;
}

/** The next action and whose it is, or null when the request has ended. */
export function nextAction(state: string): string | null {
  return RESOURCE_REQUEST_STAGES[state]?.next ?? null;
}
