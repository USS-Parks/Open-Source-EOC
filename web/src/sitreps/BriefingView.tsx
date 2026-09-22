import { LIFELINE_STATUS_COLOR, type SitrepRow } from "@openeoc/shared";
import { StatusBadge, type Status } from "../design/components.js";
import { Icon, LifelineIcon, type LifelineKey } from "../design/icons/index.js";
import "./sitreps.css";

const LIFELINE_LABEL: Record<string, string> = {
  safety_security: "Safety and Security",
  food_hydration_shelter: "Food, Hydration, Shelter",
  health_medical: "Health and Medical",
  energy: "Energy",
  communications: "Communications",
  transportation: "Transportation",
  hazardous_materials: "Hazardous Materials",
  water_systems: "Water Systems",
};

const LIFELINE_BADGE: Record<string, Status> = {
  green: "success", yellow: "warning", red: "critical", gray: "unknown",
};

function lifelineStatus(value: string): Status {
  return LIFELINE_BADGE[LIFELINE_STATUS_COLOR[value] ?? "gray"] ?? "unknown";
}

function displayTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "Not reported";
}

function esfStatus(capacity: string | null): Status {
  if (capacity === "adequate") return "success";
  if (capacity === "constrained") return "warning";
  if (capacity === "critical") return "critical";
  return "unknown";
}

export function BriefingView(props: { sitrep: SitrepRow }) {
  const { period, composedAt, composedBy, content } = props.sitrep;
  const incidentName = content.incident?.name ?? props.sitrep.incidentName ?? "Jurisdiction-wide briefing";
  const revision = props.sitrep.revision ?? content.revision ?? 1;
  const sourceTime = props.sitrep.sourceTime ?? content.sourceTime ?? composedAt;
  const esfs = content.esfs ?? [];
  const talkingPoints = content.talkingPoints ?? [];
  return (
    <article className="eoc-briefing" aria-label={`Situation report: ${period}`}>
      <header className="eoc-briefing-header">
        <span className="eoc-briefing-icon" aria-hidden="true"><Icon decorative name="briefing" size={32} /></span>
        <div>
          <span className="eoc-sitrep-eyebrow">Frozen operational briefing · FOUO</span>
          <h1>Situation Report</h1>
          <p>{incidentName} · Operational period {period}</p>
        </div>
        <span className="eoc-sitrep-revision">Revision {revision}</span>
      </header>

      <dl className="eoc-briefing-meta">
        <div><dt>Sources through</dt><dd>{displayTime(sourceTime)}</dd></div>
        <div><dt>Frozen</dt><dd>{displayTime(composedAt)}</dd></div>
        <div><dt>Prepared by</dt><dd>{composedBy}</dd></div>
        <div><dt>Distribution</dt><dd>Authorized operational use</dd></div>
      </dl>

      <section aria-labelledby="briefing-lifelines">
        <div className="eoc-sitrep-section-heading">
          <div><span className="eoc-sitrep-eyebrow">Current at source time</span><h2 id="briefing-lifelines">Community Lifelines</h2></div>
          <span>{content.lifelines.length} functions</span>
        </div>
        <div className="eoc-briefing-lifelines">
          {content.lifelines.map((line) => (
            <article key={line.lifeline} data-testid={`lifeline-${line.lifeline}`}>
              <header>
                <LifelineIcon decorative lifeline={line.lifeline as LifelineKey} size={32} />
                <div><h3>{LIFELINE_LABEL[line.lifeline] ?? line.lifeline}</h3>
                  <StatusBadge status={lifelineStatus(line.status)}>{line.status}</StatusBadge></div>
              </header>
              {line.conflict ? <p className="eoc-briefing-warning">Conflicting reports remain unresolved.</p> : null}
              <p>{line.note ?? "No impact statement reported."}</p>
              <small>Assessed {displayTime(line.at)}</small>
              {line.assessment ? <div className="eoc-briefing-attribution">
                <strong>{line.assessment.person}{line.assessment.position ? ` (${line.assessment.position})` : ""}</strong>
                <span>{line.assessment.organization}</span>
                {typeof line.assessment.payload.stabilizationOutlook === "string"
                  ? <p>{line.assessment.payload.stabilizationOutlook}</p> : null}
                {Array.isArray(line.assessment.payload.actions) ? <ul>{line.assessment.payload.actions.map((value, index) => {
                  if (!value || typeof value !== "object" || !("title" in value)) return null;
                  const action = value as Record<string, unknown>;
                  return <li key={index}>{String(action.title)} · {String(action.status ?? "Status unknown")}
                    {typeof action.dueAt === "string" ? ` · estimated ${displayTime(action.dueAt)}` : ""}</li>;
                })}</ul> : null}
              </div> : null}
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="briefing-esfs">
        <div className="eoc-sitrep-section-heading">
          <div><span className="eoc-sitrep-eyebrow">Coordination picture</span><h2 id="briefing-esfs">Emergency Support Functions</h2></div>
          <span>{esfs.length} assessed</span>
        </div>
        {esfs.length === 0 ? <p className="eoc-briefing-empty">No ESF assessments were reported for this snapshot.</p> : (
          <div className="eoc-briefing-table-wrap"><table className="eoc-briefing-table"><thead><tr>
            <th>Function</th><th>Activation</th><th>Capacity</th><th>Situation and source</th>
          </tr></thead><tbody>{esfs.map((line) => <tr key={`${line.framework}:${line.esf}`}>
            <td><strong>{line.esf.replaceAll("_", " ")}</strong><small>{line.framework}</small></td>
            <td>{line.activation ?? "unknown"}</td>
            <td><StatusBadge status={esfStatus(line.capacity)}>{line.capacity ?? "unknown"}</StatusBadge></td>
            <td>{line.conflict ? <span className="eoc-briefing-warning">Unresolved conflicting reports</span> : line.situation ?? "No situation reported"}
              {line.assessment ? <small>{line.assessment.person} · {line.assessment.organization} · {displayTime(line.assessedAt)}</small> : null}</td>
          </tr>)}</tbody></table></div>
        )}
      </section>

      <div className="eoc-briefing-columns">
        <section aria-labelledby="briefing-events"><h2 id="briefing-events">Significant events</h2>
          {content.significantEvents.length === 0 ? <p className="eoc-briefing-empty">None recorded this period.</p> : (
            <ol className="eoc-briefing-events">{content.significantEvents.map((event, index) => <li key={index}>
              <time>{displayTime(event.occurredAt)}</time><strong>{event.summary}</strong>
              {event.severity ? <StatusBadge status={event.severity === "critical" ? "critical" : "warning"}>{event.severity}</StatusBadge> : null}
            </li>)}</ol>
          )}
        </section>
        <section aria-labelledby="briefing-sources"><h2 id="briefing-sources">Source boards</h2>
          <ul className="eoc-briefing-sources">{content.boards.map((board) => <li key={`${board.key}:${board.title}`}>
            <span><Icon decorative name="source" size={16} />{board.title}</span>
            <strong>{board.records} record{board.records === 1 ? "" : "s"}</strong>
            {Object.keys(board.byStatus).length > 0 ? <small>{Object.entries(board.byStatus).map(([status, count]) => `${count} ${status}`).join(", ")}</small> : null}
          </li>)}</ul>
        </section>
      </div>

      <div className="eoc-briefing-columns">
        <section aria-labelledby="briefing-talking-points"><h2 id="briefing-talking-points">Approved talking points</h2>
          {talkingPoints.length === 0 ? <p className="eoc-briefing-empty">No approved talking points in this snapshot.</p> : (
            <ul className="eoc-briefing-points">{talkingPoints.map((point, index) => <li key={index}><strong>{point.topic}</strong><p>{point.point}</p></li>)}</ul>
          )}
        </section>
        <section aria-labelledby="briefing-rumors"><h2 id="briefing-rumors">Rumor tracking</h2>
          {content.rumorControl.length === 0 ? <p className="eoc-briefing-empty">No rumor-control entries in this snapshot.</p> : (
            <ul className="eoc-briefing-points">{content.rumorControl.map((rumor, index) => <li key={index} data-testid={`rumor-${index}`}>
              <StatusBadge status={rumor.status === "false" || rumor.status === "addressed" ? "success" : "warning"}>{rumor.status}</StatusBadge>
              <strong>{rumor.rumor}</strong>{rumor.response ? <p>{rumor.response}</p> : null}
            </li>)}</ul>
          )}
        </section>
      </div>
    </article>
  );
}
