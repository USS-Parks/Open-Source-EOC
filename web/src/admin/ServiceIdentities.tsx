import { useState } from "react";
import { SERVICE_IDENTITY_ROLES, type ServiceIdentity, type ServiceIdentityRole } from "@openeoc/shared";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../design/components.js";
import type { ApiClient } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ErrorNote, Loading } from "../app/screens/parts.js";
import { saveFile } from "./labels.js";
import "./admin.css";

const ACCESS_LABELS: Readonly<Record<ServiceIdentityRole, string>> = { viewer: "Read only", member: "Read and write" };
const DAY_MS = 86_400_000;

/** The local calendar day `days` from now, as a date input holds it. */
function localDay(days: number): string {
  const d = new Date(Date.now() + days * DAY_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type State = "Active" | "Expired" | "Revoked" | "Stopped" | "Disabled";

function stateOf(identity: ServiceIdentity): State {
  if (identity.revokedAt) return "Revoked";
  if (identity.stopped === "expired" || Date.parse(identity.expiresAt) <= Date.now()) return "Expired";
  if (identity.stopped === "creator") return "Stopped";
  return identity.stopped === "disabled" ? "Disabled" : "Active";
}

/**
 * Service identities (VC-25): integrations that call the API without riding
 * a person's session. Each reads, or reads and writes, this jurisdiction
 * only, until it expires or is revoked. Its token is shown once.
 */
export function ServiceIdentities(props: { client: ApiClient; jurisdictionId: string }) {
  const list = useAsync(() => props.client.listServiceIdentities(props.jurisdictionId), [props.jurisdictionId]);
  const [name, setName] = useState("");
  const [role, setRole] = useState<ServiceIdentityRole>("viewer");
  const [expires, setExpires] = useState(() => localDay(90));
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState("");
  const [revoking, setRevoking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const run = async (operation: () => Promise<string>) => {
    setBusy(true); setError(null); setNotice("");
    try { setNotice(await operation()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The change could not be saved."); }
    finally { setBusy(false); }
  };
  const create = () => run(async () => {
    // The identity stops at the end of the chosen day, on this device's clock.
    const end = new Date(`${expires}T23:59:59`);
    if (!name.trim() || Number.isNaN(end.getTime())) throw new Error("Enter a name and the day the identity expires.");
    const result = await props.client.createServiceIdentity(props.jurisdictionId, {
      name: name.trim(), role, expiresAt: end.toISOString(),
    });
    setCreated({ name: result.identity.name, token: result.token });
    setCopied("");
    setName("");
    list.reload();
    return `${result.identity.name} created. Copy its token now; it is not shown again.`;
  });
  const copy = () => {
    if (!created) return;
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard) { setCopied("Copying is unavailable here; select the token and copy it."); return; }
    clipboard.writeText(created.token).then(() => setCopied("Token copied."),
      () => setCopied("Copying failed; select the token and copy it."));
  };
  const revoke = (identity: ServiceIdentity) => run(async () => {
    await props.client.revokeServiceIdentity(identity.id);
    setRevoking(null);
    list.reload();
    return `${identity.name} revoked. Its next request is refused.`;
  });
  const download = () => run(async () => {
    const description = await props.client.openApiDocument();
    saveFile(new Blob([`${JSON.stringify(description, null, 2)}\n`], { type: "application/json" }), "openeoc-openapi.json");
    return "The API description was saved as openeoc-openapi.json.";
  });

  return (
    <div className="admin-tab">
      {error ? <p className="d21-error" role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {created ? <Panel title="New service identity token">
        <div className="admin-stack">
          <p className="d21-muted">Give this token to the system that will use the identity. It is shown only now; the server keeps a hash it cannot be read back from. It is sent as the bearer token.</p>
          <label className="admin-field">Token for {created.name}
            <input readOnly value={created.token} className="admin-input is-fill" onFocus={(event) => event.target.select()} />
          </label>
          <div className="d21-toolbar">
            <span className="d21-muted" role="status">{copied}</span>
            <span className="admin-actions">
              <Button onClick={copy}>Copy token</Button>
              <Button kind="quiet" onClick={() => setCreated(null)}>I have stored the token</Button>
            </span>
          </div>
        </div>
      </Panel> : null}
      <Panel title="Create a service identity">
        <fieldset disabled={busy} className="eoc-fieldset eoc-stack">
          <p className="d21-muted">A service identity lets another system call this server without a person's account. It acts in this jurisdiction only, cannot sign in to the console, and every change it makes is recorded under its own name.</p>
          <div className="d21-form-grid">
            <TextField label="Name" value={name} onChange={setName} required />
            <EnumSelect label="Access" values={SERVICE_IDENTITY_ROLES} labels={ACCESS_LABELS} value={role}
              onChange={(value) => setRole(value as ServiceIdentityRole)} />
            <label className="admin-field">Expires at the end of
              <input type="date" value={expires} min={localDay(0)} max={localDay(365)}
                onChange={(event) => setExpires(event.target.value)} className="admin-input" />
            </label>
          </div>
          <div className="d21-toolbar">
            <span className="d21-muted">Days end at midnight in {Intl.DateTimeFormat().resolvedOptions().timeZone}. An identity lives at most a year.</span>
            <span className="admin-actions">
              <Button onClick={() => void download()}>Download the API description</Button>
              <Button kind="primary" onClick={() => void create()}>Create identity</Button>
            </span>
          </div>
        </fieldset>
      </Panel>
      <Panel title="Service identities">
        {list.error ? <ErrorNote message={list.error} /> : null}
        {!list.data && !list.error ? <Loading label="Loading service identities…" /> : null}
        {list.data?.length === 0 ? <p className="d21-muted">No service identities. Integrations have no access until one is created.</p> : null}
        <ul className="d21-readiness-list">
          {(list.data ?? []).map((identity) => {
            const state = stateOf(identity);
            return (
              <li key={identity.id} className="d21-readiness-row" aria-label={`Service identity ${identity.name}`}>
                <div className="d21-readiness-title">
                  <div><strong>{identity.name}</strong><span>{ACCESS_LABELS[identity.role]} in this jurisdiction</span></div>
                </div>
                <span className="d21-readiness-badge"><StatusBadge status={state === "Active" ? "success" : "unknown"}>{state}</StatusBadge></span>
                <dl className="d21-metrics">
                  <div><dt>Created</dt><dd>{new Date(identity.createdAt).toLocaleString()} by {identity.createdBy}</dd></div>
                  <div><dt>{state === "Revoked" ? "Revoked at" : "Expires"}</dt><dd>{state === "Revoked"
                    ? `${new Date(identity.revokedAt!).toLocaleString()} by ${identity.revokedBy ?? "an administrator"}`
                    : new Date(identity.expiresAt).toLocaleString()}</dd></div>
                  <div><dt>Last used</dt><dd>{identity.lastUsedAt ? new Date(identity.lastUsedAt).toLocaleString() : "Never"}</dd></div>
                </dl>
                {state === "Stopped" ? <p className="d21-muted">Stopped: {identity.createdBy} no longer administers this jurisdiction. It works again only if they do; another administrator creates a new identity to replace it.</p> : null}
                {state === "Disabled" ? <p className="d21-muted">Disabled through the People routes. It is refused until an administrator enables it again.</p> : null}
                {state !== "Revoked" ? <div className="d21-card-actions">
                  {revoking === identity.id ? <>
                    <span className="d21-muted">Revoking refuses its next request and cannot be undone.</span>
                    <span className="admin-pair">
                      <Button kind="danger" disabled={busy} onClick={() => void revoke(identity)}>Confirm revoking {identity.name}</Button>
                      <Button onClick={() => setRevoking(null)}>Keep {identity.name}</Button>
                    </span>
                  </> : <Button kind="danger" disabled={busy} onClick={() => setRevoking(identity.id)}>Revoke {identity.name}</Button>}
                </div> : null}
              </li>
            );
          })}
        </ul>
        <div className="d21-toolbar">
          <span className="d21-muted">Last use is kept to the minute.</span>
          <Button disabled={busy} onClick={() => list.reload()}>Refresh</Button>
        </div>
      </Panel>
    </div>
  );
}
