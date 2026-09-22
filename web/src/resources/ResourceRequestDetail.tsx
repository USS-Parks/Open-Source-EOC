import type { ResourceRequestDetail } from "@openeoc/shared";
import { Button, Panel, StatusBadge } from "../design/components.js";

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
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <StatusBadge status={detail.state === "closed" ? "success" : detail.state === "cancelled" ? "unknown" : "info"}>{detail.state}</StatusBadge>
        <span>{detail.quantity} requested · {detail.priority} priority</span>
      </div>
      <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: 12, margin: 0 }}>
        <div><dt style={{ color: "var(--eoc-text-muted)" }}>Receiving organization</dt><dd style={{ margin: "4px 0 0" }}>{detail.receivingOrganization.name}</dd></div>
        <div><dt style={{ color: "var(--eoc-text-muted)" }}>Supplying organization</dt><dd style={{ margin: "4px 0 0" }}>{detail.supplyingOrganization?.name ?? "Not identified"}</dd></div>
        <div><dt style={{ color: "var(--eoc-text-muted)" }}>Assignment</dt><dd style={{ margin: "4px 0 0" }}>{labelAssignment(detail)}</dd></div>
      </dl>
      <section aria-label="Request history">
        <h3 style={{ marginTop: 0 }}>History</h3>
        <ol style={{ display: "grid", gap: 8, margin: 0, paddingLeft: 20 }}>
          {detail.chronology.map((entry, index) => <li key={`${entry.at}-${index}`}>
            <strong>{eventLabel(entry.fromState, entry.toState)}</strong>
            <span> · {new Date(entry.at).toLocaleString()}</span>
            {entry.by ? <span> · {entry.by}</span> : null}
            {entry.note ? <div style={{ color: "var(--eoc-text-muted)" }}>{entry.note}</div> : null}
          </li>)}
        </ol>
      </section>
      <div><Button onClick={props.onClose}>Close history</Button></div>
    </div>
  </Panel>;
}
