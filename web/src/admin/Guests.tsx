import { useState } from "react";
import { Button, Panel, StatusBadge, TextField } from "../design/components.js";
import type { AdminGuestGrant, ApiClient, BoardListItem, GuestGrantPage } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ErrorNote, Loading } from "../app/screens/parts.js";
import { scopeLabel } from "./labels.js";
import "./admin.css";

/**
 * Guest access for mutual aid: an existing account from another organization
 * gets time-boxed read access to positions or to chosen boards of this
 * jurisdiction. Incident participation is separate and lives with the incident.
 */
export function Guests(props: { client: ApiClient; jurisdictionId: string; boards: readonly BoardListItem[] }) {
  const first = useAsync(() => props.client.listGuestGrants(props.jurisdictionId), [props.jurisdictionId]);
  const [more, setMore] = useState<{ base: GuestGrantPage; grants: readonly AdminGuestGrant[]; nextCursor: string | null } | null>(null);
  const loaded = first.data && more?.base === first.data ? more
    : first.data ? { base: first.data, grants: first.data.grants, nextCursor: first.data.nextCursor } : null;
  const [email, setEmail] = useState("");
  const [scopes, setScopes] = useState<ReadonlySet<string>>(new Set(["positions:read"]));
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const run = async (operation: () => Promise<string>, reload = true) => {
    setBusy(true); setError(null); setNotice("");
    try { setNotice(await operation()); if (reload) first.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The change could not be saved."); }
    finally { setBusy(false); }
  };
  const toggle = (scope: string) => setScopes((current) => {
    const next = new Set(current);
    if (next.has(scope)) next.delete(scope); else next.add(scope);
    return next;
  });
  const options = ["positions:read", ...props.boards.map((b) => `board:${b.id}:read`)];

  return (
    <div className="admin-tab">
      {error ? <p className="d21-error" role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <Panel title="Grant guest access">
        <fieldset disabled={busy} className="eoc-fieldset eoc-stack">
          <div className="d21-form-grid">
            <TextField label="Guest account email" value={email} onChange={setEmail} required />
            <label className="admin-field">Access ends
              <input type="datetime-local" value={expires} onChange={(event) => setExpires(event.target.value)}
                className="admin-input" />
            </label>
            <fieldset className="d21-form-section">
              <legend>Access</legend>
              {options.map((scope) => (
                <label key={scope} className="eoc-check">
                  <input type="checkbox" checked={scopes.has(scope)} onChange={() => toggle(scope)} />
                  {scopeLabel(scope, props.boards)}
                </label>
              ))}
            </fieldset>
          </div>
          <div className="d21-toolbar">
            <span className="d21-muted">The guest signs in with their own account. Times use {Intl.DateTimeFormat().resolvedOptions().timeZone}.</span>
            <Button kind="primary" onClick={() => void run(async () => {
              if (!email.trim() || !expires || scopes.size === 0) throw new Error("Enter the guest's email, what they may read and when access ends.");
              const person = await props.client.findPersonByEmail(email.trim());
              await props.client.createGuestGrant(props.jurisdictionId, {
                personId: person.id, scopes: [...scopes], expiresAt: new Date(expires).toISOString(),
              });
              setEmail("");
              return `Guest access granted to ${person.displayName}.`;
            })}>Grant access</Button>
          </div>
        </fieldset>
      </Panel>
      <Panel title="Guest grants">
        {first.error && !loaded ? <ErrorNote message={first.error} /> : null}
        {!loaded && !first.error ? <Loading label="Loading guest grants…" /> : null}
        {loaded?.grants.length === 0 ? <p className="d21-muted">No guest grants. Jurisdiction members keep their own access.</p> : null}
        <ul className="d21-readiness-list">
          {(loaded?.grants ?? []).map((grant) => {
            const state = grant.revokedAt ? "Revoked" : Date.parse(grant.expiresAt) <= Date.now() ? "Expired" : "Active";
            return (
              <li key={grant.id} className="d21-readiness-row" aria-label={`Guest grant for ${grant.person.displayName}`}>
                <div className="d21-readiness-title">
                  <div><strong>{grant.person.displayName}</strong><span>{grant.person.email}</span></div>
                </div>
                <span className="d21-readiness-badge"><StatusBadge status={state === "Active" ? "success" : "unknown"}>{state}</StatusBadge></span>
                <dl className="d21-metrics">
                  <div><dt>Access</dt><dd>{grant.scopes.map((s) => scopeLabel(s, props.boards)).join("; ")}</dd></div>
                  <div><dt>Ends</dt><dd>{new Date(grant.revokedAt ?? grant.expiresAt).toLocaleString()}</dd></div>
                </dl>
                {state === "Active" ? <div className="d21-card-actions">
                  <Button kind="danger" disabled={busy} onClick={() => void run(async () => {
                    await props.client.revokeGuestGrant(grant.id);
                    return `Guest access for ${grant.person.displayName} revoked.`;
                  })}>Revoke access for {grant.person.displayName}</Button>
                </div> : null}
              </li>
            );
          })}
        </ul>
        {loaded?.nextCursor ? <div className="d21-toolbar">
          <span className="d21-muted">Older grants are on the next page.</span>
          <Button disabled={busy} onClick={() => void run(async () => {
            const next = await props.client.listGuestGrants(props.jurisdictionId, { cursor: loaded.nextCursor! });
            setMore({ base: loaded.base, grants: [...loaded.grants, ...next.grants], nextCursor: next.nextCursor });
            return "";
          }, false)}>Load older grants</Button>
        </div> : null}
      </Panel>
    </div>
  );
}
