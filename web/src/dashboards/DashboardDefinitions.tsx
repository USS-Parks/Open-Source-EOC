import { useState } from "react";
import { Button, Panel, TextField } from "../design/components.js";
import type { ApiClient, DashboardListItem } from "../app/api/client.js";
import { saveFile } from "../admin/labels.js";
import type { DashboardDefinitionOption } from "./DashboardConfigurator.js";
import "../datasets/datasets.css";

/**
 * The jurisdiction's dashboards, each built from a published dashboard
 * template. Administrators create one from a template key; anyone who can see
 * a dashboard's definition can download its template as JSON.
 */
export function DashboardDefinitions(props: {
  readonly client: ApiClient;
  readonly jurisdictionId: string;
  readonly isAdmin: boolean;
  readonly dashboards: readonly DashboardListItem[];
  /** Loaded definitions carry the template version an export needs. */
  readonly definitions: readonly DashboardDefinitionOption[];
  readonly onCreated?: (() => void) | undefined;
}) {
  const [templateKey, setTemplateKey] = useState("");
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const run = async (operation: () => Promise<string>) => {
    setBusy(true); setError(null); setNotice("");
    try { setNotice(await operation()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The request failed."); }
    finally { setBusy(false); }
  };
  const create = () => run(async () => {
    const key = templateKey.trim();
    const pinned = version.trim() === "" ? undefined : Number(version.trim());
    if (!key) throw new Error("Enter the dashboard template key.");
    if (pinned !== undefined && !(Number.isInteger(pinned) && pinned >= 1)) throw new Error("Enter a whole version number, or leave it empty for the latest.");
    await props.client.createDashboard(props.jurisdictionId, {
      templateKey: key,
      ...(pinned !== undefined ? { version: pinned } : {}),
      ...(title.trim() ? { title: title.trim() } : {}),
    });
    setTemplateKey(""); setVersion(""); setTitle("");
    props.onCreated?.();
    return `Dashboard created from template ${key}.`;
  });
  const exportTemplate = (definition: DashboardDefinitionOption) => run(async () => {
    const { key, version: v } = definition.template;
    const template = await props.client.exportDashboardTemplate(key, v);
    saveFile(new Blob([JSON.stringify(template, null, 2)], { type: "application/json" }), `${key}-v${v}.json`);
    return `Template ${key} version ${v} downloaded.`;
  });
  const keys = [...new Set(props.dashboards.map((d) => d.templateKey))];

  return (
    <Panel title="Jurisdiction dashboards">
      {error ? <p className="d21-error" role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {props.dashboards.length === 0 ? <p className="d21-muted">No dashboards in this jurisdiction yet.</p> : (
        <ul className="d21-readiness-list" aria-label="Jurisdiction dashboards">
          {props.dashboards.map((dashboard) => {
            const definition = props.definitions.find((d) => d.id === dashboard.id);
            return (
              <li key={dashboard.id} className="d21-readiness-row" aria-label={dashboard.title}>
                <div className="d21-readiness-title"><div><strong>{dashboard.title}</strong>
                  <span>Template {dashboard.templateKey}{definition ? ` · version ${definition.template.version}` : ""}</span></div></div>
                {definition ? <div className="d21-card-actions">
                  <Button disabled={busy} onClick={() => void exportTemplate(definition)}>Export template for {dashboard.title}</Button>
                </div> : null}
              </li>
            );
          })}
        </ul>
      )}
      {props.isAdmin ? <fieldset disabled={busy} className="d21-form-section" style={{ marginTop: 12 }}>
        <legend>Create a dashboard</legend>
        <div className="d21-form-section-grid">
          <TextField label="Dashboard template key" value={templateKey} onChange={setTemplateKey} required />
          <TextField label="Template version (empty for the latest)" value={version} onChange={setVersion} />
          <TextField label="Dashboard title (empty uses the template's)" value={title} onChange={setTitle} />
        </div>
        <div className="d21-toolbar">
          <span className="d21-muted">{keys.length ? `Templates in use: ${keys.join(", ")}.` : "An instance administrator publishes dashboard templates."}</span>
          <Button kind="primary" onClick={() => void create()}>Create dashboard</Button>
        </div>
      </fieldset> : null}
    </Panel>
  );
}
