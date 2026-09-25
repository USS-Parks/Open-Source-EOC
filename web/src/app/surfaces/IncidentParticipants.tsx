import { useState } from "react";
import { INCIDENT_PARTICIPANT_ROLE_SCOPE, type IncidentParticipantRole } from "@openeoc/shared";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../../design/components.js";
import type { ApiClient } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { ErrorNote, Loading } from "../screens/parts.js";
import { GrantPreviewPanel } from "./GrantPreview.js";
import "./incidents.css";

export function IncidentParticipants(props: {
  client: ApiClient; incidentId: string; incidentName: string; canManage: boolean; closed: boolean;
}) {
  const roster = useAsync(() => props.client.listIncidentParticipants(props.incidentId), [props.incidentId]);
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [personEmail, setPersonEmail] = useState("");
  const [positionTitle, setPositionTitle] = useState("");
  const [role, setRole] = useState<IncidentParticipantRole>("viewer");
  const [expires, setExpires] = useState("");
  const [reason, setReason] = useState("");
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null); setNotice("");
    try { await operation(); roster.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The participant change could not be saved."); }
    finally { setBusy(false); }
  };
  const grant = () => run(async () => {
    if (!organizationSlug.trim() || !personEmail.trim() || !positionTitle.trim() || !expires || !reason.trim())
      throw new Error("Enter the organization code, account email, incident position, expiry and reason.");
    await props.client.addIncidentParticipant(props.incidentId, { organizationSlug: organizationSlug.trim(),
      personEmail: personEmail.trim(), incidentPositionTitle: positionTitle.trim(), role,
      expiresAt: new Date(expires).toISOString(), reason: reason.trim() });
    setPersonEmail(""); setPositionTitle(""); setReason("");
    setNotice("Participant added. Their notifications hold an invitation that names this incident, your organization and the access granted.");
  });
  const revoke = () => run(async () => {
    if (!revokeId || !revokeReason.trim()) throw new Error("Enter a reason for ending participation.");
    await props.client.revokeIncidentParticipant(props.incidentId, revokeId, revokeReason.trim());
    setRevokeId(null); setRevokeReason(""); setNotice("Participation ended. Incident access has been revoked.");
  });
  if (roster.error) return <ErrorNote message={roster.error} />;
  return <Panel title={props.incidentName + ": participants"}>
    <div className="incidents-section">
      <p className="eoc-flush">The host organization controls this incident. A participant grant gives only the selected person access to this incident; it does not establish unified command, transfer ownership, or grant access to another incident.</p>
      {props.canManage && !props.closed ? <fieldset disabled={busy} className="incidents-fieldset">
        <TextField label="Organization code" value={organizationSlug} onChange={setOrganizationSlug} />
        <p className="eoc-flush eoc-muted">Use the registered organization's code and the participant's existing account email.</p>
        <TextField label="Participant email" value={personEmail} onChange={setPersonEmail} />
        <TextField label="Incident position" value={positionTitle} onChange={setPositionTitle} />
        <EnumSelect label="Incident role" values={["viewer", "contributor", "coordinator"]} value={role}
          onChange={(value) => setRole(value as IncidentParticipantRole)}
          labels={{ viewer: "Read only", contributor: "Contributor", coordinator: "Coordinator" }} />
        <label>Participation expires <input type="datetime-local" value={expires} onChange={(event) => setExpires(event.target.value)} /></label>
        <p className="eoc-flush">Expiry uses {Intl.DateTimeFormat().resolvedOptions().timeZone}. A coordinator may revise the operational area when the engine authorizes it. Only host-organization administrators manage participation.</p>
        <TextField label="Participation reason" value={reason} onChange={setReason} />
        <div><Button kind="primary" onClick={() => void grant()} disabled={busy}>Add participant</Button></div>
      </fieldset> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {roster.loading && !roster.data ? <Loading label="Loading participants…" /> : null}
      {roster.data?.length === 0 ? <p>No additional participants. The sponsoring organization's existing access remains in effect.</p> : null}
      <ul className="incidents-participants">
        {(roster.data ?? []).map((participant) => {
          const ended = Boolean(participant.revokedAt) || Date.parse(participant.expiresAt) <= Date.now();
          return <li key={participant.id} className="incidents-participant">
            <div className="incidents-row">
              <strong>{participant.personName}</strong><span>{participant.organizationName}</span>
              <StatusBadge status={ended ? "unknown" : "info"}>{participant.revokedAt ? "revoked" : ended ? "expired" : "active"}</StatusBadge>
            </div>
            <p>Participant grant: {participant.role} · Incident position: {participant.incidentPositionTitle} · Expires {new Date(participant.expiresAt).toLocaleString()}</p>
            <p className="eoc-flush">Can {INCIDENT_PARTICIPANT_ROLE_SCOPE[participant.role]}.</p>
            {participant.invitation ? <p className="eoc-flush">Invitation delivered {new Date(participant.invitation.deliveredAt).toLocaleString()}; {participant.invitation.readAt ? `read ${new Date(participant.invitation.readAt).toLocaleString()}` : "not read yet"}.</p>
              : props.canManage ? <p className="eoc-flush eoc-muted">No invitation on record; this grant predates invitations.</p> : null}
            <p className="eoc-flush eoc-muted">The incident position is an assignment for this participant. It does not itself establish command authority.</p>
            {props.canManage ? <Button onClick={() => setPreviewId(previewId === participant.id ? null : participant.id)} disabled={busy}>
              {previewId === participant.id ? "Hide preview" : `Preview what ${participant.personName} can read`}</Button> : null}
            {previewId === participant.id ? <GrantPreviewPanel client={props.client} incidentId={props.incidentId} participantId={participant.id} onClose={() => setPreviewId(null)} /> : null}
            {props.canManage && !participant.revokedAt ? <Button onClick={() => { setRevokeId(participant.id); setRevokeReason(""); }} disabled={busy}>End participation for {participant.personName}</Button> : null}
            {revokeId === participant.id ? <div className="incidents-revoke">
              <p className="eoc-flush">Ending participation stops {participant.personName}'s access from now on. It does not recall what was already delivered: exports, printed forms and notifications stay with whoever received them.</p>
              <TextField label="Reason for ending participation" value={revokeReason} onChange={setRevokeReason} />
              <div className="incidents-pair">
                <Button kind="danger" onClick={() => void revoke()} disabled={busy || !revokeReason.trim()}>End participation</Button>
                <Button onClick={() => setRevokeId(null)} disabled={busy}>Cancel</Button>
              </div>
            </div> : null}
          </li>;
        })}
      </ul>
      <div><Button onClick={() => roster.reload()} disabled={busy || roster.loading}>Refresh participants</Button></div>
    </div>
  </Panel>;
}
