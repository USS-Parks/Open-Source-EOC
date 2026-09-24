import type { ResourceRequestDetail } from "@openeoc/shared";
import { Button, Panel, StatusBadge } from "../design/components.js";
import "./resources.css";

function labelAssignment(detail: ResourceRequestDetail): string {
  if (!detail.assignment) return "Not assigned";
  if (detail.assignment.kind === "position") {
    return `${detail.assignment.positionTitle} · ${detail.assignment.organization.name}`;
  }
  return `${detail.assignment.personName} · ${detail.assignment.incidentPositionTitle} · ${detail.assignment.organization.name}`;
}

function eventLabel(fromState: string | null, toState: string): string {
  return fromState ? `${fromState} → ${toState}` : toState;
}

export function ResourceRequestDetailPanel(props: {
  detail: ResourceRequestDetail;
  onClose: () => void;
}) {
  const { detail } = props;
  return <Panel title={`${detail.item}: request history`}>
    <div className="resources-detail">
      <div className="resources-row">
        <StatusBadge status={detail.state === "closed" ? "success" : detail.state === "cancelled" ? "unknown" : "info"}>{detail.state}</StatusBadge>
        <span>{detail.quantity} requested · {detail.priority} priority</span>
      </div>
      <dl className="resources-facts">
        <div><dt>Receiving organization</dt><dd>{detail.receivingOrganization.name}</dd></div>
        <div><dt>Supplying organization</dt><dd>{detail.supplyingOrganization?.name ?? "Not identified"}</dd></div>
        <div><dt>Assignment</dt><dd>{labelAssignment(detail)}</dd></div>
      </dl>
      <section aria-label="Request history">
        <h3 className="resources-first">History</h3>
        <ol className="resources-history">
          {detail.chronology.map((entry, index) => <li key={`${entry.at}-${index}`}>
            <strong>{eventLabel(entry.fromState, entry.toState)}</strong>
            <span> · {new Date(entry.at).toLocaleString()}</span>
            {entry.by ? <span> · {entry.by}</span> : null}
            {entry.note ? <div className="eoc-muted">{entry.note}</div> : null}
          </li>)}
        </ol>
      </section>
      <div><Button onClick={props.onClose}>Close history</Button></div>
    </div>
  </Panel>;
}
