import { useState, type FormEvent, type ReactNode } from "react";
import {
  VOLUNTEER_AFFILIATIONS,
  VOLUNTEER_AFFILIATION_LABELS,
  credentialKey,
  deploymentWarnings,
  type VolunteerAffiliation,
  type VolunteerDeploymentView,
  type VolunteerInput,
  type VolunteerRoster,
  type VolunteerView,
} from "@openeoc/shared";
import { EnumSelect, StatusBadge } from "../design/components.js";
import { ActionButton, Tabs } from "../design/controls.js";
import { EmptyState, ErrorState, LoadingState } from "../design/feedback.js";
import type { ApiClient } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { icsDateTime, instant } from "../staffing/model.js";
import "./volunteers.css";

/**
 * Volunteer and CERT roster (VC-20): the jurisdiction's volunteers with their
 * affiliation, skills and credentials, their deployments on incidents, and
 * the hours those make. Writers enter and edit volunteers; a partner
 * organization taking part in the selected incident enters and reads its own.
 */

type VolunteersClient = Pick<ApiClient,
  "volunteerRoster" | "incidentVolunteerRoster" | "createVolunteer" | "createIncidentVolunteer" | "updateVolunteer" |
  "deployVolunteer" | "updateVolunteerDeployment" | "removeVolunteerDeployment">;

type View = "roster" | "deployments" | "hours";
const VIEWS: ReadonlyArray<{ id: View; label: string }> = [
  { id: "roster", label: "Roster" },
  { id: "deployments", label: "Deployments" },
  { id: "hours", label: "Hours" },
];

const localZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const pad = (n: number) => String(n).padStart(2, "0");
/** An instant as a datetime-local value in the browser's time zone. */
export const localInput = (value: string): string => {
  const at = new Date(value);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
};
/** Hours and minutes, exact, so a volunteer's days add up to their total as shown. */
export const hoursText = (minutes: number): string => `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
const hidden = (text: string) => <span className="eoc-visually-hidden">{text}</span>;

interface CredentialDraft { name: string; issuer: string; issuedOn: string; expiresOn: string }
export interface VolunteerDraft {
  readonly id: string | null;
  name: string;
  affiliation: VolunteerAffiliation;
  affiliationName: string;
  phone: string;
  email: string;
  skills: string;
  credentials: CredentialDraft[];
  notes: string;
  active: boolean;
}

export function volunteerDraft(volunteer?: VolunteerView): VolunteerDraft {
  return {
    id: volunteer?.id ?? null,
    name: volunteer?.name ?? "",
    affiliation: volunteer?.affiliation ?? "cert",
    affiliationName: volunteer?.affiliationName ?? "",
    phone: volunteer?.contact?.phone ?? "",
    email: volunteer?.contact?.email ?? "",
    skills: volunteer?.skills.join(", ") ?? "",
    credentials: (volunteer?.credentials ?? []).map((c) => ({
      name: c.name, issuer: c.issuer, issuedOn: c.issuedOn ?? "", expiresOn: c.expiresOn ?? "",
    })),
    notes: volunteer?.notes ?? "",
    active: volunteer?.active ?? true,
  };
}

/** The draft as the API takes it: skills split at commas, blank credential rows left out. */
export function volunteerInput(draft: VolunteerDraft): VolunteerInput {
  if (!draft.name.trim()) throw new Error("Enter the volunteer's name.");
  const credentials = draft.credentials.filter((c) => c.name.trim() || c.issuer.trim() || c.issuedOn || c.expiresOn);
  credentials.forEach((c, index) => {
    if (!c.name.trim()) throw new Error(`Credential ${index + 1}: enter its name.`);
    if (c.issuedOn && c.expiresOn && c.expiresOn < c.issuedOn) throw new Error(`Credential ${index + 1}: it expires before it is issued.`);
  });
  return {
    name: draft.name.trim(),
    affiliation: draft.affiliation,
    affiliationName: draft.affiliationName.trim(),
    phone: draft.phone.trim(),
    email: draft.email.trim(),
    skills: [...new Set(draft.skills.split(",").map((s) => s.trim()).filter(Boolean))],
    credentials: credentials.map((c) => ({
      name: c.name.trim(), issuer: c.issuer.trim(), issuedOn: c.issuedOn || null, expiresOn: c.expiresOn || null,
    })),
    notes: draft.notes.trim(),
    active: draft.active,
  };
}

interface DeploymentDraft {
  readonly id: string | null;
  volunteerId: string;
  role: string;
  startsAt: string;
  endsAt: string;
  needs: string[];
  note: string;
}

const emptyDeployment = (volunteerId = ""): DeploymentDraft =>
  ({ id: null, volunteerId, role: "", startsAt: "", endsAt: "", needs: [], note: "" });

function Credentials(props: { volunteer: VolunteerView }) {
  if (props.volunteer.credentials.length === 0) return <>None recorded</>;
  return <ul className="eoc-volunteers-list">{props.volunteer.credentials.map((c) => <li key={c.name}>
    <span>{c.name}{c.issuer ? `, ${c.issuer}` : ""}: {c.expiresOn ? `expires ${c.expiresOn}` : "no expiry"}</span>
    {c.expired ? <StatusBadge status="warning">Expired</StatusBadge> : null}
  </li>)}</ul>;
}

export function VolunteersSurface(props: {
  readonly client: VolunteersClient;
  readonly jurisdictionId: string;
  readonly incidentId: string | null;
  readonly incidentName: string | null;
}) {
  const { client } = props;
  const zone = localZone();
  const [view, setView] = useState<View>("roster");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<VolunteerDraft>(() => volunteerDraft());
  const [deployment, setDeployment] = useState<DeploymentDraft>(() => emptyDeployment());
  // The needs the volunteer lacks, shown once before the deployment is saved anyway.
  const [warned, setWarned] = useState<readonly string[] | null>(null);

  const roster = useAsync<VolunteerRoster>(() => props.incidentId
    ? client.incidentVolunteerRoster(props.incidentId, zone)
    : client.volunteerRoster(props.jurisdictionId, zone), [client, props.jurisdictionId, props.incidentId, zone]);
  const r = roster.data;
  const volunteers = r?.volunteers ?? [];
  const canWrite = Boolean(r?.entry);
  const knownCredentials = [...new Map(volunteers.flatMap((v) => v.credentials.map((c) => [credentialKey(c.name), c.name] as const))).values()]
    .sort((a, b) => a.localeCompare(b));

  const act = async (work: () => Promise<string>) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      setNotice(await work());
      roster.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  const editDeployment = (next: DeploymentDraft) => { setDeployment(next); setWarned(null); };

  const saveVolunteer = (event: FormEvent) => {
    event.preventDefault();
    void act(async () => {
      const input = volunteerInput(draft);
      if (draft.id) await client.updateVolunteer(draft.id, input);
      else if (r?.entry === "organization" && props.incidentId) await client.createIncidentVolunteer(props.incidentId, input);
      else await client.createVolunteer(r?.jurisdictionId ?? props.jurisdictionId, input);
      setDraft(volunteerDraft());
      return draft.id ? `Saved ${input.name}.` : `Added ${input.name} to the roster.`;
    });
  };

  const saveDeployment = (event: FormEvent) => {
    event.preventDefault();
    const volunteer = volunteers.find((v) => v.id === deployment.volunteerId);
    const startsAt = instant(deployment.startsAt);
    const endsAt = deployment.endsAt ? instant(deployment.endsAt) : null;
    if (!volunteer || !startsAt || endsAt === undefined || !deployment.role.trim()) {
      setError("Choose the volunteer, and enter the role and when the deployment starts.");
      return;
    }
    // The last day it covers, in this browser's time zone, as the roster reads it.
    const lastDay = deployment.endsAt ? deployment.endsAt.slice(0, 10)
      : [deployment.startsAt.slice(0, 10), r?.today ?? ""].sort().at(-1)!;
    const lacking = deploymentWarnings(volunteer.credentials, deployment.needs, lastDay);
    if (lacking.length > 0 && !warned) {
      setWarned(lacking);
      return;
    }
    void act(async () => {
      const details = { role: deployment.role.trim(), startsAt, endsAt, needs: deployment.needs, note: deployment.note.trim() };
      if (deployment.id) await client.updateVolunteerDeployment(deployment.id, details);
      else await client.deployVolunteer(volunteer.id, { incidentId: props.incidentId!, ...details });
      editDeployment(emptyDeployment());
      const saved = deployment.id ? `Saved the deployment of ${volunteer.name}.` : `Deployed ${volunteer.name} as ${details.role}.`;
      return lacking.length ? `${saved} Warning: ${lacking.join("; ")}.` : saved;
    });
  };

  const remove = (row: VolunteerDeploymentView) => act(async () => {
    await client.removeVolunteerDeployment(row.id);
    if (deployment.id === row.id) editDeployment(emptyDeployment());
    return `Removed the deployment of ${row.volunteerName} as ${row.role}.`;
  });

  const state = (content: () => ReactNode) => roster.loading && !r ? <LoadingState label="Loading volunteers…" />
    : roster.error && !r ? <ErrorState title="Volunteers unavailable" message={roster.error}
      action={<ActionButton onClick={roster.reload}>Retry</ActionButton>} />
      : content();

  const setCredential = (index: number, change: Partial<CredentialDraft>) =>
    setDraft({ ...draft, credentials: draft.credentials.map((c, i) => (i === index ? { ...c, ...change } : c)) });

  const volunteerForm = () => <form className="eoc-volunteers-form" onSubmit={saveVolunteer}
    aria-label={draft.id ? `Edit ${draft.name || "the volunteer"}` : "Add a volunteer"}>
    <h2>{draft.id ? `Edit ${draft.name || "the volunteer"}` : "Add a volunteer"}</h2>
    {r?.entry === "organization" ? <p className="eoc-volunteers-hint">Volunteers you add here are your organization's, for {props.incidentName ?? "this incident"}; only your organization and the jurisdiction's staff see them.</p> : null}
    <div className="eoc-volunteers-fields">
      <label>Name<input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <EnumSelect label="Affiliation" values={VOLUNTEER_AFFILIATIONS} value={draft.affiliation} labels={VOLUNTEER_AFFILIATION_LABELS}
        onChange={(affiliation) => setDraft({ ...draft, affiliation: affiliation as VolunteerAffiliation })} />
      <label>Team, group or organization<input value={draft.affiliationName} onChange={(e) => setDraft({ ...draft, affiliationName: e.target.value })} /></label>
      <label>Phone<input type="tel" autoComplete="off" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></label>
      <label>Email<input type="email" autoComplete="off" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></label>
      <label>Skills, separated by commas<input value={draft.skills} onChange={(e) => setDraft({ ...draft, skills: e.target.value })} /></label>
    </div>
    <datalist id="volunteer-credential-names">{knownCredentials.map((name) => <option key={name} value={name} />)}</datalist>
    {draft.credentials.map((c, index) => <fieldset key={index}>
      <legend>Credential {index + 1}</legend>
      <div className="eoc-volunteers-fields">
        <label>{hidden(`Credential ${index + 1} `)}Name<input list="volunteer-credential-names" value={c.name}
          onChange={(e) => setCredential(index, { name: e.target.value })} /></label>
        <label>{hidden(`Credential ${index + 1} `)}Issuer<input value={c.issuer} onChange={(e) => setCredential(index, { issuer: e.target.value })} /></label>
        <label>{hidden(`Credential ${index + 1} `)}Issued<input type="date" value={c.issuedOn} onChange={(e) => setCredential(index, { issuedOn: e.target.value })} /></label>
        <label>{hidden(`Credential ${index + 1} `)}Expires<input type="date" value={c.expiresOn} onChange={(e) => setCredential(index, { expiresOn: e.target.value })} /></label>
      </div>
      <ActionButton kind="quiet" onClick={() => setDraft({ ...draft, credentials: draft.credentials.filter((_, i) => i !== index) })}>
        Remove credential {index + 1}</ActionButton>
    </fieldset>)}
    <div className="eoc-volunteers-actions">
      <ActionButton kind="secondary" onClick={() => setDraft({ ...draft, credentials: [...draft.credentials, { name: "", issuer: "", issuedOn: "", expiresOn: "" }] })}>
        Add a credential</ActionButton>
    </div>
    <div className="eoc-volunteers-fields">
      <label>Notes<textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
    </div>
    {draft.id ? <div className="eoc-volunteers-checks"><label>
      <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />Active</label></div> : null}
    <div className="eoc-volunteers-actions">
      <ActionButton kind="primary" type="submit" loading={busy} loadingLabel="Saving…">{draft.id ? "Save volunteer" : "Add volunteer"}</ActionButton>
      {draft.id ? <ActionButton kind="quiet" onClick={() => setDraft(volunteerDraft())}>Cancel</ActionButton> : null}
    </div>
  </form>;

  const rosterTable = () => volunteers.length === 0
    ? <EmptyState title="No volunteers yet" description={canWrite ? "Volunteers you add are listed here with their credentials." : "Volunteers the jurisdiction enters are listed here."} />
    : <div className="eoc-volunteers-scroll"><table className="eoc-table">
      <thead><tr><th scope="col">Name</th><th scope="col">Affiliation</th><th scope="col">Skills</th><th scope="col">Credentials</th>
        {r?.canSeeContacts ? <th scope="col">Contact</th> : null}<th scope="col">Entered by</th>{canWrite ? <th scope="col">Action</th> : null}</tr></thead>
      <tbody>{volunteers.map((v) => <tr key={v.id}>
        <td>{v.name}{v.active ? null : <> <StatusBadge status="unknown">Inactive</StatusBadge></>}</td>
        <td>{VOLUNTEER_AFFILIATION_LABELS[v.affiliation]}{v.affiliationName ? `, ${v.affiliationName}` : ""}</td>
        <td>{v.skills.join(", ") || "None recorded"}</td>
        <td><Credentials volunteer={v} /></td>
        {r?.canSeeContacts ? <td>{v.contact?.phone || v.contact?.email ? <ul className="eoc-volunteers-list">
          {[v.contact.phone, v.contact.email].filter(Boolean).map((line) => <li key={line} className="eoc-volunteers-nowrap">{line}</li>)}
        </ul> : "None recorded"}</td> : null}
        <td>{v.enteredBy?.organizationName ?? "Jurisdiction staff"}</td>
        {canWrite ? <td><div className="eoc-volunteers-actions">
          <ActionButton kind="quiet" onClick={() => setDraft(volunteerDraft(v))}>Edit {v.name}</ActionButton>
          {props.incidentId && v.active ? <ActionButton kind="quiet" onClick={() => { editDeployment(emptyDeployment(v.id)); setView("deployments"); }}>
            Deploy {v.name}</ActionButton> : null}
        </div></td> : null}
      </tr>)}</tbody>
    </table></div>;

  const deploymentForm = () => {
    const editing = deployment.id !== null;
    const choices = volunteers.filter((v) => v.active || v.id === deployment.volunteerId);
    const name = volunteers.find((v) => v.id === deployment.volunteerId)?.name ?? "the volunteer";
    const title = editing ? `Edit the deployment of ${name}` : "Deploy a volunteer";
    return <form className="eoc-volunteers-form" onSubmit={saveDeployment} aria-label={title}>
      <h2>{title}</h2>
      <p className="eoc-volunteers-hint">On {props.incidentName ?? "the selected incident"}. Times are local, in {zone}.</p>
      <div className="eoc-volunteers-fields">
        <EnumSelect label="Volunteer" values={["", ...choices.map((v) => v.id)]} value={deployment.volunteerId}
          labels={{ "": "Choose a volunteer", ...Object.fromEntries(choices.map((v) => [v.id, v.name])) }}
          selectProps={{ required: true, disabled: editing }} onChange={(volunteerId) => editDeployment({ ...deployment, volunteerId })} />
        <label>Role<input required value={deployment.role} onChange={(e) => editDeployment({ ...deployment, role: e.target.value })} /></label>
        <label>Starts<input type="datetime-local" required value={deployment.startsAt} onChange={(e) => editDeployment({ ...deployment, startsAt: e.target.value })} /></label>
        <label>Ends, blank while under way<input type="datetime-local" value={deployment.endsAt} onChange={(e) => editDeployment({ ...deployment, endsAt: e.target.value })} /></label>
        <label>Note<input value={deployment.note} onChange={(e) => editDeployment({ ...deployment, note: e.target.value })} /></label>
      </div>
      {knownCredentials.length ? <fieldset>
        <legend>Credentials the role needs</legend>
        <div className="eoc-volunteers-checks">{knownCredentials.map((credential) => <label key={credential}>
          <input type="checkbox" checked={deployment.needs.includes(credential)} onChange={(e) => editDeployment({
            ...deployment, needs: e.target.checked ? [...deployment.needs, credential] : deployment.needs.filter((n) => n !== credential),
          })} />{credential}</label>)}</div>
      </fieldset> : <p className="eoc-volunteers-hint">Credentials recorded on the roster can be named here as ones the role needs.</p>}
      {warned ? <p className="eoc-volunteers-notice is-warning" role="alert">
        {name} does not have what the role needs: {warned.join("; ")}. Deploy anyway, or change the volunteer or the needs.</p> : null}
      <div className="eoc-volunteers-actions">
        <ActionButton kind="primary" type="submit" loading={busy} loadingLabel="Saving…">
          {warned ? "Deploy anyway" : editing ? "Save deployment" : "Deploy"}</ActionButton>
        {editing ? <ActionButton kind="quiet" onClick={() => editDeployment(emptyDeployment())}>Cancel</ActionButton> : null}
      </div>
    </form>;
  };

  const deploymentsTable = () => {
    const rows = r?.deployments ?? [];
    return rows.length === 0 ? <EmptyState title="No deployments" description="Deployments put a volunteer on an incident in a role; their hours come from them." />
      : <div className="eoc-volunteers-scroll"><table className="eoc-table">
        <thead><tr><th scope="col">Volunteer</th><th scope="col">Role</th>{props.incidentId ? null : <th scope="col">Incident</th>}
          <th scope="col">Starts</th><th scope="col">Ends</th><th scope="col">Needs</th><th scope="col">Warnings</th>{canWrite ? <th scope="col">Action</th> : null}</tr></thead>
        <tbody>{rows.map((d) => <tr key={d.id}>
          <td>{d.volunteerName}</td><td>{d.role}</td>{props.incidentId ? null : <td>{d.incidentName}</td>}
          <td><time dateTime={d.startsAt}>{icsDateTime(d.startsAt)}</time></td>
          <td>{d.endsAt ? <time dateTime={d.endsAt}>{icsDateTime(d.endsAt)}</time> : "Under way"}</td>
          <td>{d.needs.join(", ") || "None"}</td>
          <td>{d.warnings.length ? <ul className="eoc-volunteers-list">{d.warnings.map((w) => <li key={w}><StatusBadge status="warning">{w}</StatusBadge></li>)}</ul> : "None"}</td>
          {canWrite ? <td><div className="eoc-volunteers-actions">
            {d.incidentId === props.incidentId ? <ActionButton kind="quiet" onClick={() => editDeployment({
              id: d.id, volunteerId: d.volunteerId, role: d.role, startsAt: localInput(d.startsAt),
              endsAt: d.endsAt ? localInput(d.endsAt) : "", needs: [...d.needs], note: d.note,
            })}>Edit the deployment of {d.volunteerName}</ActionButton> : null}
            <ActionButton kind="quiet" disabled={busy} onClick={() => void remove(d)}>Remove the deployment of {d.volunteerName}</ActionButton>
          </div></td> : null}
        </tr>)}</tbody>
      </table></div>;
  };

  const hoursPanel = () => {
    const hours = r?.hours ?? [];
    const totals = new Map<string, { name: string; days: number; minutes: number }>();
    for (const day of hours) {
      const total = totals.get(day.volunteerId) ?? { name: day.volunteerName, days: 0, minutes: 0 };
      totals.set(day.volunteerId, { ...total, days: total.days + 1, minutes: total.minutes + day.minutes });
    }
    const all = hours.reduce((sum, day) => sum + day.minutes, 0);
    return <>
      <p className="eoc-volunteers-hint">
        Hours come from ended deployments{props.incidentId ? ` on ${props.incidentName ?? "this incident"}` : ""}, one row per volunteer per day in {r?.timeZone ?? zone}.
        Where one volunteer's deployments overlap, the time is counted once.
      </p>
      {r?.underWay.length ? <p className="eoc-volunteers-notice is-warning" role="note">
        Under way, and not counted until they end: {r.underWay.map((u) => `${u.volunteerName} since ${icsDateTime(u.since)}`).join("; ")}.</p> : null}
      {hours.length === 0 ? <EmptyState title="No hours yet" description="Hours appear once a deployment has ended." /> : <>
        <div className="eoc-volunteers-scroll"><table className="eoc-table">
          <caption>Hours by day</caption>
          <thead><tr><th scope="col">Volunteer</th><th scope="col">Date</th><th scope="col">Hours (h:mm)</th></tr></thead>
          <tbody>{hours.map((day) => <tr key={`${day.volunteerId}:${day.date}`}>
            <td>{day.volunteerName}</td><td>{day.date}</td><td>{hoursText(day.minutes)}</td></tr>)}</tbody>
        </table></div>
        <div className="eoc-volunteers-scroll"><table className="eoc-table">
          <caption>Hours by volunteer</caption>
          <thead><tr><th scope="col">Volunteer</th><th scope="col">Days</th><th scope="col">Hours (h:mm)</th></tr></thead>
          <tbody>{[...totals].map(([id, total]) => <tr key={id}><td>{total.name}</td><td>{total.days}</td><td>{hoursText(total.minutes)}</td></tr>)}</tbody>
          <tfoot><tr><th scope="row">All volunteers</th><td>{hours.length}</td><td>{hoursText(all)}</td></tr></tfoot>
        </table></div>
      </>}
    </>;
  };

  const panels: Record<View, () => ReactNode> = {
    roster: () => state(() => <>
      {canWrite ? volunteerForm() : null}
      <section className="eoc-volunteers-block" aria-labelledby="volunteers-roster"><h2 id="volunteers-roster">Roster</h2>{rosterTable()}</section>
    </>),
    deployments: () => state(() => <>
      {canWrite ? props.incidentId ? deploymentForm()
        : <p className="eoc-volunteers-hint">Select an incident to deploy volunteers on it.</p> : null}
      <section className="eoc-volunteers-block" aria-labelledby="volunteers-deployments"><h2 id="volunteers-deployments">Deployments</h2>{deploymentsTable()}</section>
    </>),
    hours: () => state(() => <section className="eoc-volunteers-block" aria-labelledby="volunteers-hours">
      <h2 id="volunteers-hours">Hours</h2>{hoursPanel()}</section>),
  };

  return <section className="eoc-volunteers" aria-label="Volunteers">
    <header className="eoc-volunteers-header">
      <p className="eoc-volunteers-eyebrow">{props.incidentName ?? "Whole jurisdiction"}</p>
      <h2 className="eoc-visually-hidden">Volunteers</h2>
      <p>Volunteers and CERT members, their credentials, their deployments on incidents and the hours those make.
        {r && !r.canSeeContacts ? " Contact details are shown only to the jurisdiction's staff and the organization that entered a volunteer." : null}</p>
    </header>
    <Tabs id="volunteers-view" label="Volunteers view" value={view} onChange={(next) => setView(next as View)} tabs={VIEWS} />
    {notice ? <p className="eoc-volunteers-notice" role="status">{notice}</p> : null}
    {error ? <p className="eoc-volunteers-notice is-error" role="alert">{error}</p> : null}
    {VIEWS.map(({ id }) => <section key={id} className="eoc-volunteers-panel" role="tabpanel" id={`volunteers-view-${id}-panel`}
      aria-labelledby={`volunteers-view-${id}-tab`} hidden={view !== id}>{view === id ? panels[id]() : null}</section>)}
  </section>;
}
