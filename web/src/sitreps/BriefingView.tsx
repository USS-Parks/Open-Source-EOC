import { LIFELINE_STATUS_COLOR, type SitrepRow } from "@openeoc/shared";
import { StatusBadge, type Status } from "../design/components.js";

/**
 * Briefing view (VEOC-20, F8). The Incident Status Dashboard role: an
 * executive read of one archived sitrep, and the surface a public
 * information officer derives a statement from. It renders the frozen
 * archive, never the live boards, so the briefing is stable while it is
 * being given.
 */

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
  green: "success",
  yellow: "warning",
  red: "critical",
  gray: "unknown",
};

function lifelineStatus(value: string): Status {
  const color = LIFELINE_STATUS_COLOR[value] ?? "gray";
  return LIFELINE_BADGE[color] ?? "unknown";
}

export function BriefingView(props: { sitrep: SitrepRow }) {
  const { period, composedAt, composedBy, content } = props.sitrep;
  return (
    <article aria-label={`Situation report: ${period}`} style={{ maxWidth: 760 }}>
      <header style={{ borderBottom: "2px solid var(--eoc-border)", paddingBottom: 8 }}>
        <h2 style={{ margin: "0 0 4px" }}>Situation Report</h2>
        <p style={{ margin: 0, color: "var(--eoc-text-muted)" }}>
          Operational period {period} · composed {new Date(composedAt).toLocaleString()} by{" "}
          {composedBy}
        </p>
      </header>

      <section aria-label="Community Lifelines" style={{ marginTop: 16 }}>
        <h3 style={{ margin: "0 0 8px" }}>Community Lifelines</h3>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
          {content.lifelines.map((l) => (
            <li
              key={l.lifeline}
              data-testid={`lifeline-${l.lifeline}`}
              style={{ display: "flex", justifyContent: "space-between", gap: 8 }}
            >
              <span>{LIFELINE_LABEL[l.lifeline] ?? l.lifeline}</span>
              <StatusBadge status={lifelineStatus(l.status)}>{l.status}</StatusBadge>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Board status" style={{ marginTop: 16 }}>
        <h3 style={{ margin: "0 0 8px" }}>Board status</h3>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
          {content.boards.map((b) => (
            <li key={b.key} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{b.title}</span>
              <span style={{ color: "var(--eoc-text-muted)" }}>
                {b.records} record{b.records === 1 ? "" : "s"}
                {Object.keys(b.byStatus).length > 0
                  ? ` (${Object.entries(b.byStatus)
                      .map(([s, n]) => `${n} ${s}`)
                      .join(", ")})`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Significant events" style={{ marginTop: 16 }}>
        <h3 style={{ margin: "0 0 8px" }}>Significant events</h3>
        {content.significantEvents.length === 0 ? (
          <p style={{ margin: 0, color: "var(--eoc-text-muted)" }}>None recorded this period.</p>
        ) : (
          <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>
            {content.significantEvents.map((e, i) => (
              <li key={i}>
                {e.summary}
                {e.severity ? ` — ${e.severity}` : ""}
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}
