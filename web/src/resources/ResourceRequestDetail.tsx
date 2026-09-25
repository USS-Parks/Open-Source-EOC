import type { ResourceRequestDetail } from "@openeoc/shared";
import { Button, Panel, StatusBadge } from "../design/components.js";
import { nextAction, ownerLabel, requestStage, stageTone, when } from "./request-view.js";
import "./resources.css";

function eventLabel(fromState: string | null, toState: string): string {
  return fromState ? `${requestStage(fromState)} → ${requestStage(toState)}` : requestStage(toState);
}

/**
 * One request as its asker and its owner need it: when it was received and
 * where it went, whether anyone has accepted it, who owns the next action and
 * what it is, and every step since with who took it and why.
 */
export function ResourceRequestDetailPanel(props: {
  detail: ResourceRequestDetail;
  onClose: () => void;
}) {
  const { detail } = props;
  const next = nextAction(detail.state);
  return <Panel title={`REQ-${detail.number} ${detail.item}`}>
    <div className="resources-detail">
      <div className="resources-row">
        <StatusBadge status={stageTone(detail.state)}>{requestStage(detail.state)}</StatusBadge>
        <span>{detail.quantity} requested · {detail.priority} priority</span>
      </div>
      <dl className="resources-facts">
        <div><dt>Received</dt><dd>{when(detail.createdAt)}{detail.requestedByName ? ` from ${detail.requestedByName}` : ""}</dd></div>
        <div><dt>Sent to</dt><dd>{detail.receivingOrganization.name}</dd></div>
        <div><dt>Accepted</dt><dd>{detail.acceptance
          ? `${when(detail.acceptance.at)} by ${detail.acceptance.personName}${detail.acceptance.positionTitle ? `, ${detail.acceptance.positionTitle}` : ""}`
          : detail.state === "declined" || detail.state === "cancelled" ? "No" : "Not yet: receipt is not acceptance"}</dd></div>
        <div><dt>Owner</dt><dd>{ownerLabel(detail)}</dd></div>
        <div><dt>Next action</dt><dd>{next ?? "None: the request has ended"}</dd></div>
        <div><dt>Supplying organization</dt><dd>{detail.supplyingOrganization?.name ?? "Not identified"}</dd></div>
      </dl>
      <section aria-label="Request history">
        <h3 className="resources-first">History</h3>
        <ol className="resources-history">
          {detail.chronology.map((entry, index) => <li key={`${entry.at}-${index}`}>
            <strong>{eventLabel(entry.fromState, entry.toState)}</strong>
            <span> · {when(entry.at)}</span>
            {entry.by ? <span> · {entry.by}</span> : null}
            {entry.note ? <div className="eoc-muted">{entry.note}</div> : null}
          </li>)}
        </ol>
      </section>
      <div><Button onClick={props.onClose}>Close details</Button></div>
    </div>
  </Panel>;
}
