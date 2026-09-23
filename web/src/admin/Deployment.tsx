import { useState } from "react";
import { Button, Panel, StatusBadge, TextField } from "../design/components.js";
import type { ApiClient } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ErrorNote, Loading } from "../app/screens/parts.js";
import { INTEGRATION_LABELS } from "./labels.js";
import { CollabSettings } from "../integrations/collab.js";
import { MeetingSettings } from "../integrations/meetings.js";

/**
 * Deployment-wide settings: which optional integrations the server registers,
 * which only the deployment environment can change, and provisioning of a new
 * jurisdiction by an instance administrator. A jurisdiction administrator,
 * named by `jurisdictionId`, also configures the collaboration and meeting
 * integrations the deployment runs.
 */
export function Deployment(props: { client: ApiClient; isInstanceAdmin: boolean; jurisdictionId?: string }) {
  const state = useAsync(() => props.client.listIntegrations(), []);
  const { jurisdictionId } = props;
  const on = (key: string) => state.data?.integrations.some((i) => i.key === key && i.enabled) ?? false;
  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      <Panel title="Optional integrations">
        {state.error ? <ErrorNote message={state.error} /> : null}
        {!state.data && !state.error ? <Loading label="Loading integrations…" /> : null}
        {state.data ? <>
          <ul className="d21-readiness-list">
            {state.data.integrations.map((integration) => (
              <li key={integration.key} className="d21-readiness-row" aria-label={INTEGRATION_LABELS[integration.key] ?? integration.key}>
                <div className="d21-readiness-title">
                  <div>
                    <strong>{INTEGRATION_LABELS[integration.key] ?? "Unnamed integration"}</strong>
                    <span>Listed as <code>{integration.key}</code> in {state.data!.variable}</span>
                  </div>
                </div>
                <span style={{ alignSelf: "start" }}>
                  <StatusBadge status={integration.enabled ? "success" : "unknown"}>{integration.enabled ? "Enabled" : "Not enabled"}</StatusBadge>
                </span>
              </li>
            ))}
          </ul>
          <p className="d21-muted" style={{ marginTop: 12 }}>This screen shows the deployment's setting and cannot change it. To enable an integration, add its name to {state.data.variable} in the server environment, for example {state.data.variable}=meetings,tracking, and restart the server.</p>
        </> : null}
      </Panel>
      {jurisdictionId && on("collab") ? <CollabSettings client={props.client} jurisdictionId={jurisdictionId} /> : null}
      {jurisdictionId && on("meetings") ? <MeetingSettings client={props.client} jurisdictionId={jurisdictionId} /> : null}
      {props.isInstanceAdmin ? <Provision client={props.client} /> : null}
    </div>
  );
}

function Provision(props: { client: ApiClient }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const provision = async () => {
    setBusy(true); setError(null); setNotice("");
    try {
      if (!name.trim() || !slug.trim() || !email.trim()) throw new Error("Enter the jurisdiction name, its short name and the first administrator's email.");
      const admin = await props.client.findPersonByEmail(email.trim());
      const result = await props.client.provisionJurisdiction({ slug: slug.trim(), name: name.trim(), adminPersonId: admin.id });
      setNotice(`${name.trim()} is ready with ${result.positions} standard positions. ${admin.displayName} administers it.`);
      setName(""); setSlug(""); setEmail("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The jurisdiction could not be provisioned.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Provision a jurisdiction">
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 12 }}>
        <div className="d21-form-grid">
          <TextField label="Jurisdiction name" value={name} onChange={setName} required />
          <TextField label="Short name" value={slug} onChange={setSlug} required />
          <div className="d21-form-grid-wide">
            <TextField label="First administrator email" value={email} onChange={setEmail} required />
          </div>
        </div>
        {error ? <p className="d21-error" role="alert">{error}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
        <div className="d21-toolbar">
          <span className="d21-muted">The first administrator needs an existing account; create it under People first. The new jurisdiction starts with the ICS Command and General Staff positions.</span>
          <Button kind="primary" onClick={() => void provision()}>Provision jurisdiction</Button>
        </div>
      </fieldset>
    </Panel>
  );
}
