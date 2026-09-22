import type { CSSProperties } from "react";
import type { IcsFormContent } from "@openeoc/shared";

const cell: CSSProperties = {
  border: "1px solid var(--eoc-border)",
  padding: "5px 8px",
  textAlign: "left",
  verticalAlign: "top",
};

export const FORM_TITLES: Readonly<Record<string, string>> = {
  "ICS-201": "Incident Briefing",
  "ICS-202": "Incident Objectives",
  "ICS-203": "Organization Assignment List",
  "ICS-204": "Assignment List",
  "ICS-205": "Incident Radio Communications Plan",
  "ICS-206": "Medical Plan",
  "ICS-207": "Incident Organization Chart",
  "ICS-208": "Safety Message/Plan",
  "ICS-211": "Incident Check-In List",
  "ICS-213": "General Message",
  "ICS-214": "Activity Log",
  "ICS-215": "Operational Planning Worksheet",
};

export function formLabel(id: string): string {
  return FORM_TITLES[id] ? `${id} ${FORM_TITLES[id]}` : id;
}

/** Render one stored or server-prefilled ICS form without changing its content. */
export function FormPreview(props: { readonly form: IcsFormContent }) {
  const form = props.form;
  return (
    <article className="iap-form-preview" aria-label={formLabel(form.id)}>
      <header>
        <strong>{form.id} {form.title}</strong>
        <p>
          {form.incidentName} · {form.operationalPeriod || "Operational period unavailable"}
          {" · "}Prepared by {form.preparedBy}
        </p>
      </header>
      {form.sections.map((section, sectionIndex) => (
        <section key={`${section.heading}-${sectionIndex}`}>
          <h4>{section.heading}</h4>
          {section.columns && section.rows ? (
            <div className="iap-table-scroll">
              <table className="eoc-table" style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    {section.columns.map((column) => <th key={column} style={cell}>{column}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {section.rows.length === 0 ? (
                    <tr>
                      <td style={{ ...cell, color: "var(--eoc-text-muted)" }} colSpan={section.columns.length}>
                        (none recorded)
                      </td>
                    </tr>
                  ) : section.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((value, columnIndex) => (
                        <td key={columnIndex} style={cell}>{value}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {section.lines ? (
            <ul>
              {section.lines.length === 0
                ? <li className="iap-muted">(none recorded)</li>
                : section.lines.map((line, lineIndex) => <li key={lineIndex}>{line}</li>)}
            </ul>
          ) : null}
        </section>
      ))}
    </article>
  );
}
