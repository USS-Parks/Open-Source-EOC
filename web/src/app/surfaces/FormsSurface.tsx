import { useState, type CSSProperties } from "react";
import { ICS_FORM_IDS, type IcsFormContent } from "@openeoc/shared";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../../design/components.js";
import type { ApiClient, IapResult } from "../api/client.js";
import { EmptyState, Scroll, SurfaceHeader } from "../screens/parts.js";

/**
 * ICS forms and the IAP, for an operator (F5). The forms engine and PDF
 * export already live server-side; this is the screen that reaches them:
 * pick an incident and operational period, preview any of the twelve ICS
 * forms prefilled from live incident data, assemble the operational period's
 * IAP, download it as a PDF, and (as an admin) approve it.
 */

const FORM_TITLES: Record<string, string> = {
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

const cell: CSSProperties = {
  border: "1px solid var(--eoc-border)",
  padding: "4px 8px",
  textAlign: "left",
  verticalAlign: "top",
};

function formLabel(id: string): string {
  return FORM_TITLES[id] ? `${id} ${FORM_TITLES[id]}` : id;
}

/** One prefilled ICS form rendered as its sections. */
function FormView(props: { form: IcsFormContent }) {
  const f = props.form;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div>
        <strong>
          {f.id} {f.title}
        </strong>
        <div style={{ color: "var(--eoc-text-muted)", fontSize: "0.9em" }}>
          {f.incidentName} · OP {f.operationalPeriod || "(unset)"} · Prepared by {f.preparedBy}
        </div>
      </div>
      {f.sections.map((s, si) => (
        <div key={si}>
          <h4 style={{ margin: "0 0 4px" }}>{s.heading}</h4>
          {s.columns && s.rows ? (
            <table className="eoc-table" style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  {s.columns.map((c) => (
                    <th key={c} style={cell}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.rows.length === 0 ? (
                  <tr>
                    <td style={{ ...cell, color: "var(--eoc-text-muted)" }} colSpan={s.columns.length}>
                      (none recorded)
                    </td>
                  </tr>
                ) : (
                  s.rows.map((r, ri) => (
                    <tr key={ri}>
                      {r.map((v, ci) => (
                        <td key={ci} style={cell}>
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : null}
          {s.lines ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {s.lines.length === 0 ? (
                <li style={{ listStyle: "none", color: "var(--eoc-text-muted)" }}>(none recorded)</li>
              ) : (
                s.lines.map((l, li) => <li key={li}>{l}</li>)
              )}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function FormsSurface(props: { client: ApiClient; incidentId: string | null; isAdmin: boolean }) {
  const [period, setPeriod] = useState("");
  const [formId, setFormId] = useState<string>(ICS_FORM_IDS[0]);
  const [preview, setPreview] = useState<IcsFormContent | null>(null);
  const [iap, setIap] = useState<IapResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = props.incidentId;
  if (!active)
    return (
      <EmptyState
        label="No incident selected."
        hint="Choose an incident in the command bar; its ICS forms and IAP assemble from live data here."
      />
    );

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doPreview = () =>
    run(async () => {
      setPreview(await props.client.getIcsForm(active, formId, period));
    });
  const doAssemble = () =>
    run(async () => {
      const op = period || "OP 1";
      const r = await props.client.createIap(active, { operationalPeriod: op });
      setIap({ id: r.id, status: "draft", operationalPeriod: op, content: r.content });
    });
  const doApprove = () =>
    run(async () => {
      if (!iap) return;
      await props.client.approveIap(iap.id);
      setIap({ ...iap, status: "approved" });
    });
  const doDownload = () =>
    run(async () => {
      if (!iap) return;
      const blob = await props.client.downloadIapPdf(iap.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `iap-${iap.operationalPeriod.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "op"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

  return (
    <Scroll>
      <SurfaceHeader title="ICS Forms & IAP" />
      <div style={{ display: "grid", gap: 16, maxWidth: 920 }}>
        <Panel title="Build">
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <TextField label="Operational period" value={period} onChange={setPeriod} />
            <EnumSelect
              label="ICS form"
              values={ICS_FORM_IDS as readonly string[]}
              value={formId}
              onChange={setFormId}
              labels={FORM_TITLES}
            />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <Button onClick={doPreview} disabled={busy}>
              Preview form
            </Button>
            <Button kind="primary" onClick={doAssemble} disabled={busy}>
              Assemble IAP
            </Button>
          </div>
          {error ? (
            <p role="alert" style={{ color: "var(--eoc-status-critical)", margin: "8px 0 0" }}>
              {error}
            </p>
          ) : null}
        </Panel>

        {preview ? (
          <Panel title={`Preview: ${formLabel(preview.id)}`}>
            <FormView form={preview} />
          </Panel>
        ) : null}

        {iap ? (
          <Panel title="Incident Action Plan">
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
              <StatusBadge status={iap.status === "approved" ? "success" : "info"}>
                {iap.status}
              </StatusBadge>
              <span style={{ color: "var(--eoc-text-muted)" }}>
                OP {iap.operationalPeriod} · {iap.content.forms.length} forms
              </span>
              <span style={{ flex: 1 }} />
              <Button onClick={doDownload} disabled={busy}>
                Download PDF
              </Button>
              {props.isAdmin && iap.status !== "approved" ? (
                <Button kind="primary" onClick={doApprove} disabled={busy}>
                  Approve
                </Button>
              ) : null}
            </div>
            <div style={{ display: "grid", gap: 20 }}>
              {iap.content.forms.map((f) => (
                <FormView key={f.id} form={f} />
              ))}
            </div>
          </Panel>
        ) : null}
      </div>
    </Scroll>
  );
}
