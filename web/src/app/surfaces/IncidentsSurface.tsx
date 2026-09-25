import { useMemo, useState } from "react";
import type { ThemeName } from "../../design/tokens.js";
import { IncidentAreaEditor } from "./IncidentAreaEditor.js";
import { IncidentParticipants } from "./IncidentParticipants.js";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../../design/components.js";
import {
  OperationalTable,
  createOperationalTableViewState,
  type OperationalTableColumn,
  type OperationalTableViewState,
} from "../../design/table.js";
import type {
  ApiClient, IncidentArchiveFilter, IncidentOverviewPage, IncidentOverviewRow, LibraryKind, Membership,
} from "../api/client.js";
import { formatTime } from "../../datasets/format.js";
import { IncidentCollaboration } from "../../integrations/collab.js";
import { IncidentMeetings } from "../../integrations/meetings.js";
import { useAsync } from "../data/hooks.js";
import { ErrorNote, Loading, Scroll, SurfaceHeader } from "../screens/parts.js";
import "./incidents.css";

const KIND_LABELS: Readonly<Record<string, string>> = {
  incident: "Incident", daily_ops: "Daily operations", planned_event: "Planned event", exercise: "Exercise",
};

/**
 * Incident lifecycle for the operator (F12): activate an incident from a
 * scenario template in one action (org chart, boards, checklists, and
 * libraries follow), see what is running, and close it. Activation,
 * closure and new libraries are admin-gated; everyone sees the list. The
 * holder of a checklist item's position completes it here.
 */
export function IncidentsSurface(props: {
  client: ApiClient;
  jurisdictionId: string;
  isAdmin: boolean;
  theme: ThemeName;
  /** Optional integrations the server runs; their incident actions show only when on. */
  integrations?: ReadonlySet<string>;
  memberships?: readonly Membership[];
  /** The signed-in person's current position key, which may complete that position's checklist items. */
  positionKey?: string | null;
  /** Called with a newly activated incident, so the workspace can switch to
   *  it; activation stays busy until the switch settles. */
  onActivated?: (incidentId: string) => Promise<void> | void;
  /** The incident list changed shape (closed or reopened); the incident switcher reads it again. */
  onChanged?: () => void;
}) {
  const [reload, setReload] = useState(0);
  const [selectedIncident, setSelectedIncident] = useState<string | null>(null);
  const [closeCandidate, setCloseCandidate] = useState<string | null>(null);
  const incidents = useAsync(
    () => props.client.listIncidents(props.jurisdictionId),
    [props.jurisdictionId, reload],
  );
  const templates = useAsync(
    () => (props.isAdmin ? props.client.listIncidentTemplates() : Promise.resolve([])),
    [props.isAdmin],
  );
  const detail = useAsync(
    () => selectedIncident ? props.client.getIncident(selectedIncident) : Promise.resolve(null),
    [selectedIncident, reload],
  );
  const [templateKey, setTemplateKey] = useState("");
  const [kind, setKind] = useState<"incident" | "daily_ops" | "planned_event" | "exercise">("incident");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [libraryTitle, setLibraryTitle] = useState("");
  const [libraryKind, setLibraryKind] = useState<LibraryKind>("scenario");
  const [libraryTemplate, setLibraryTemplate] = useState("");
  const [libraryBody, setLibraryBody] = useState("");
  const [reopenCandidate, setReopenCandidate] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState("");

  const run = async (fn: () => Promise<unknown>, done = "") => {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await fn();
      setNotice(done);
      setReload((n) => n + 1);
      // Closing, reopening and lockdown change what the console shows for the incident.
      props.onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const tpls = templates.data ?? [];
  const activeTpl = templateKey || tpls[0]?.key || "";

  const activate = () =>
    run(async () => {
      if (!activeTpl || !name.trim()) throw new Error("Pick a template and enter an incident name.");
      const activated = await props.client.activateIncident(props.jurisdictionId, {
        templateKey: activeTpl,
        name: name.trim(),
        kind,
      });
      setName("");
      setSelectedIncident(activated.incidentId);
      await props.onActivated?.(activated.incidentId);
    });

  const addLibrary = () =>
    run(async () => {
      if (!libraryTitle.trim()) throw new Error("Enter a library title.");
      await props.client.createLibrary(props.jurisdictionId, {
        title: libraryTitle.trim(),
        kind: libraryKind,
        body: libraryBody,
        ...(libraryTemplate ? { forTemplate: libraryTemplate } : {}),
      });
      setLibraryTitle("");
      setLibraryBody("");
    }, libraryTemplate
      ? `Library added. It attaches to each incident activated from ${tpls.find((t) => t.key === libraryTemplate)?.title ?? "that template"}.`
      : "Library added to the jurisdiction.");

  const list = incidents.data ?? [];

  return (
    <Scroll>
      <SurfaceHeader title="Incidents" />
      <div className="incidents-page">
        {props.isAdmin && tpls.length > 0 ? (
          <Panel title="Activate an incident">
            <div className="incidents-form-row">
              <EnumSelect
                label="Scenario template"
                values={tpls.map((t) => t.key)}
                value={activeTpl}
                onChange={setTemplateKey}
                labels={Object.fromEntries(tpls.map((t) => [t.key, t.title]))}
              />
              <TextField label="Incident name" value={name} onChange={setName} />
              <EnumSelect label="Incident type" values={["incident", "daily_ops", "planned_event", "exercise"]} value={kind}
                onChange={(value) => setKind(value as typeof kind)}
                labels={KIND_LABELS} />
            </div>
            <div className="eoc-space-above">
              <Button kind="primary" onClick={activate} disabled={busy}>
                Activate
              </Button>
            </div>
          </Panel>
        ) : null}

        {props.isAdmin ? (
          <Panel title="Add a library">
            <div className="incidents-form-row">
              <TextField label="Library title" value={libraryTitle} onChange={setLibraryTitle} />
              <EnumSelect label="Library kind" values={["scenario", "plan", "reference"]} value={libraryKind}
                onChange={(value) => setLibraryKind(value as LibraryKind)}
                labels={{ scenario: "Scenario", plan: "Plan", reference: "Reference" }} />
              <EnumSelect label="Attach to incidents from" values={["", ...tpls.map((t) => t.key)]} value={libraryTemplate}
                onChange={setLibraryTemplate}
                labels={{ "": "No template", ...Object.fromEntries(tpls.map((t) => [t.key, t.title])) }} />
            </div>
            <label className="incidents-field">Library content
              <textarea rows={3} value={libraryBody} onChange={(event) => setLibraryBody(event.target.value)} />
            </label>
            <div className="eoc-space-above">
              <Button onClick={addLibrary} disabled={busy}>Add library</Button>
            </div>
          </Panel>
        ) : null}

        <Panel title="Incidents">
          {incidents.loading && !incidents.data ? <Loading label="Loading incidents…" /> : null}
          {incidents.error && !incidents.data ? <ErrorNote message={incidents.error} /> : null}
          {incidents.data && list.length === 0 ? (
            <p className="eoc-flush eoc-muted">No incidents yet.</p>
          ) : null}
          {list.length > 0 ? (
            <ul className="incidents-list">
              {list.map((i) => (
                <li key={i.id} className="incidents-item">
                  <div className="incidents-item-body">
                    <div className="incidents-row">
                      <StatusBadge status={i.closedAt ? "unknown" : "info"}>{i.closedAt ? "closed" : "open"}</StatusBadge>
                      {i.lockedAt ? <StatusBadge status="warning">Guest access locked</StatusBadge> : null}
                      <strong>{i.name}</strong>
                      <span className="incidents-kind">{i.kind.replaceAll("_", " ")}</span>
                    </div>
                    <div className="incidents-authority">
                      <span>{i.canManageParticipation ? "Host owner administrator" : "No participation-administration authority"}</span>
                      <span aria-hidden="true">·</span>
                      <span>{i.canEditArea ? "Operational-area authority" : "No operational-area authority"}</span>
                    </div>
                  </div>
                  <div className="incidents-item-actions">
                    <Button onClick={() => { setSelectedIncident(i.id); setCloseCandidate(null); }}>Operational area</Button>
                    <Button onClick={() => { setSelectedIncident(i.id); setCloseCandidate(null); }}>Participants</Button>
                    {i.canManageParticipation && !i.closedAt ? <Button kind="danger" onClick={() => { setCloseCandidate(i.id); setReopenCandidate(null); }} disabled={busy}>Close incident</Button> : null}
                    {i.canManageParticipation && i.closedAt ? <Button onClick={() => { setReopenCandidate(i.id); setReopenReason(""); setCloseCandidate(null); }} disabled={busy}>Reopen incident</Button> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>

        <IncidentMasterView client={props.client} jurisdictionId={props.jurisdictionId} isAdmin={props.isAdmin}
          reload={reload} busy={busy} run={run} />

        {list.filter((i) => i.id === selectedIncident).map((incident) => <Panel key={incident.id} title={incident.name + ": incident setup"}>
          <div className="incidents-section">
            {incident.lockedAt ? <p role="status" className="incidents-lockdown">
              <strong>Guest access is locked.</strong> Guest grants cannot read this incident's boards or records
              until an administrator lifts the lockdown. Members and participating organizations keep their access.
            </p> : null}
            <p className="eoc-flush">The host organization is the jurisdiction that owns this incident. Its owner administrators activate and manage participation. Participants receive only their explicit grant. Incident positions describe operational command assignments; they do not by themselves transfer ownership or establish unified command.</p>
            {detail.loading && !detail.data ? <Loading label="Loading incident setup…" /> : null}
            {detail.error ? <ErrorNote message={detail.error} /> : null}
            {detail.data ? <section aria-label="Incident positions">
              <h3 className="incidents-first">Template positions</h3>
              <p className="incidents-first eoc-muted">These are the incident's available operational positions. Participant grants remain separate from command authority.</p>
              {detail.data.positions.length ? <ul className="incidents-positions">
                {detail.data.positions.map((position) => <li key={position.id}>{position.title}</li>)}
              </ul> : <p>No template positions are attached.</p>}
            </section> : null}
            {detail.data ? <section aria-label="Incident checklists">
              <h3 className="incidents-first">Checklists</h3>
              {detail.data.checklists.length ? <ul className="incidents-list">
                {detail.data.checklists.map((item) => {
                  const title = detail.data!.positions.find((p) => p.key === item.positionKey)?.title;
                  const done = item.status === "completed";
                  return <li key={item.id} aria-label={item.item} className="incidents-check">
                    <StatusBadge status={done ? "success" : "info"}>{done ? "completed" : item.status.replaceAll("_", " ")}</StatusBadge>
                    <strong>{item.item}</strong>
                    <span className="incidents-kind">
                      {done && item.completedByPosition ? `Completed by ${item.completedByPosition}` : title ? `Assigned to ${title}` : "Assigned to a participant"}
                    </span>
                    {!done && !incident.closedAt && item.positionKey && item.positionKey === props.positionKey
                      ? <Button onClick={() => run(() => props.client.completeChecklistItem(item.id), `${item.item} completed.`)} disabled={busy}>
                        Mark complete
                      </Button> : null}
                  </li>;
                })}
              </ul> : <p>No checklist items came with the template.</p>}
            </section> : null}
            {detail.data ? <section aria-label="Incident libraries">
              <h3 className="incidents-first">Libraries</h3>
              {detail.data.libraries.length ? <ul className="incidents-libraries">
                {detail.data.libraries.map((library) => <li key={library.id}>{library.title} · {library.kind}</li>)}
              </ul> : <p>No libraries are attached. A library attaches when an incident is activated from its template.</p>}
            </section> : null}
            <IncidentAreaEditor client={props.client} incidentId={incident.id} incidentName={incident.name}
              theme={props.theme} canEdit={incident.canEditArea && !incident.closedAt} />
            <IncidentParticipants client={props.client} incidentId={incident.id} incidentName={incident.name}
              canManage={incident.canManageParticipation} closed={Boolean(incident.closedAt)} />
            <IntegrationActions client={props.client} integrations={props.integrations} memberships={props.memberships} incident={incident} />
          </div>
        </Panel>)}

        {list.filter((i) => i.id === closeCandidate).map((incident) => <Panel key={incident.id} title={"Close " + incident.name}>
          <div className="eoc-stack">
            <CloseoutSummary client={props.client} incidentId={incident.id} />
            <div className="incidents-actions">
              <Button kind="danger" onClick={() => run(async () => { await props.client.closeIncident(incident.id); setCloseCandidate(null); setSelectedIncident(null); props.onChanged?.(); }, `${incident.name} is closed. Its records stay readable; an administrator can reopen it.`)} disabled={busy}>Confirm closeout</Button>
              <Button onClick={() => setCloseCandidate(null)} disabled={busy}>Keep incident open</Button>
            </div>
          </div>
        </Panel>)}

        {list.filter((i) => i.id === reopenCandidate).map((incident) => <Panel key={incident.id} title={"Reopen " + incident.name}>
          <div className="eoc-stack">
            <p className="eoc-flush">Reopening lets the incident take updates again: its requests, tasks and boards continue from where they stopped, and participant grants still in force apply again. The reason is kept in the incident's record of events.</p>
            <TextField label="Reason for reopening" value={reopenReason} onChange={setReopenReason} />
            <div className="incidents-actions">
              <Button kind="primary" onClick={() => run(async () => { await props.client.reopenIncident(incident.id, reopenReason.trim()); setReopenCandidate(null); props.onChanged?.(); }, `${incident.name} is open again.`)} disabled={busy || !reopenReason.trim()}>Confirm reopen</Button>
              <Button onClick={() => setReopenCandidate(null)} disabled={busy}>Keep incident closed</Button>
            </div>
          </div>
        </Panel>)}

        {error ? (
          <p role="alert" className="eoc-text-critical">
            {error}
          </p>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
      </div>
    </Scroll>
  );
}

const overviewStatus = (row: IncidentOverviewRow) => row.archivedAt ? "Archived" : row.closedAt ? "Closed" : "Open";

/**
 * The jurisdiction's master view: every incident it owns with its open work
 * and records, read a page at a time. Archived incidents appear only when the
 * filter asks for them. Administrators archive closed incidents here and
 * apply or lift a lockdown, which withholds one incident from guest grants.
 */
function IncidentMasterView(props: {
  client: ApiClient;
  jurisdictionId: string;
  isAdmin: boolean;
  reload: number;
  busy: boolean;
  run: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const { client, isAdmin, busy, run } = props;
  const [archived, setArchived] = useState<IncidentArchiveFilter>("exclude");
  const [tableState, setTableState] = useState<OperationalTableViewState>(() => createOperationalTableViewState([
    // Display order: state and controls first, then the rollups, then dates.
    { id: "incident", width: 200 }, { id: "status", width: 130 }, { id: "guests", width: 160 },
    { id: "actions", width: 260 }, { id: "requests", width: 190 }, { id: "tasks", width: 140 },
    { id: "records", width: 150 }, { id: "organizations", width: 210 }, { id: "period", width: 190 },
    { id: "kind", width: 160 }, { id: "opened", width: 180 }, { id: "closed", width: 180 },
  ], { pageSize: 25 }));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const response = useAsync(
    () => client.incidentOverview(props.jurisdictionId, archived),
    [props.jurisdictionId, archived, props.reload],
  );
  // Pages added with "Load more" extend the first page they were read after.
  const [more, setMore] = useState<{ base: IncidentOverviewPage; rows: IncidentOverviewRow[]; nextCursor: string | null } | null>(null);
  const loaded = response.data && more?.base === response.data ? more
    : response.data ? { base: response.data, rows: response.data.incidents, nextCursor: response.data.nextCursor } : null;
  const loadMore = loaded?.nextCursor ? async () => {
    const next = await client.incidentOverview(props.jurisdictionId, archived, { cursor: loaded.nextCursor! });
    setMore({ base: loaded.base, rows: [...loaded.rows, ...next.incidents], nextCursor: next.nextCursor });
  } : undefined;
  const rows = loaded?.rows ?? [];
  const columns = useMemo<readonly OperationalTableColumn<IncidentOverviewRow>[]>(() => [
    { id: "incident", header: "Incident", value: (row) => row.name, sortable: true, filterable: true, render: (row) => <strong>{row.name}</strong> },
    { id: "status", header: "Status", value: overviewStatus, sortable: true, filterable: true,
      render: (row) => <StatusBadge status={row.closedAt ? "unknown" : "info"}>{overviewStatus(row)}</StatusBadge> },
    { id: "kind", header: "Type", value: (row) => KIND_LABELS[row.kind] ?? row.kind, sortable: true, filterable: true },
    { id: "opened", header: "Opened", value: (row) => row.activatedAt, sortable: true, render: (row) => formatTime(row.activatedAt) },
    { id: "closed", header: "Closed", value: (row) => row.closedAt ?? "", sortable: true, missingLabel: "Still open",
      render: (row) => row.closedAt ? formatTime(row.closedAt) : "Still open" },
    { id: "period", header: "Operational period", value: (row) => row.operationalPeriod?.label ?? "", filterable: true, missingLabel: "No period set" },
    { id: "requests", header: "Open resource requests", value: (row) => row.openResourceRequests, sortable: true, align: "end" },
    { id: "tasks", header: "Open tasks", value: (row) => row.openTasks, sortable: true, align: "end" },
    { id: "records", header: "Board records", value: (row) => row.boardRecords, sortable: true, align: "end" },
    { id: "organizations", header: "Participating organizations", value: (row) => row.participatingOrganizations, sortable: true, align: "end" },
    { id: "guests", header: "Guest access", value: (row) => row.lockedAt ? "Locked" : "Guest grants apply", sortable: true, filterable: true,
      render: (row) => row.lockedAt ? <StatusBadge status="warning">Locked</StatusBadge> : <span>Guest grants apply</span> },
    ...(isAdmin ? [{ id: "actions", header: "Action", value: () => "Available actions", render: (row: IncidentOverviewRow) =>
      <div className="incidents-table-actions">
        {row.archivedAt
          ? <Button disabled={busy} onClick={() => void run(() => client.unarchiveIncident(row.id), `${row.name} is back in the incident lists.`)}>Unarchive</Button>
          : row.closedAt
            ? <Button disabled={busy} onClick={() => void run(() => client.archiveIncident(row.id), `${row.name} is archived.`)}>Archive</Button>
            : null}
        {row.lockedAt
          ? <Button disabled={busy} onClick={() => void run(() => client.unlockIncident(row.id), `Guest access to ${row.name} is restored.`)}>Lift lockdown</Button>
          : <Button kind="danger" disabled={busy} onClick={() => void run(() => client.lockIncident(row.id), `Guest access to ${row.name} is locked.`)}>Lock guest access</Button>}
      </div> }] : []),
  ], [busy, client, isAdmin, run]);
  const status = response.loading && !response.data ? "loading" : response.error && !response.data ? "error" : rows.length === 0 ? "empty" : "ready";

  return <Panel title="Jurisdiction master view">
    <div className="eoc-stack">
      <p className="eoc-flush eoc-muted">Every incident this jurisdiction owns, with its open work and records.
        A lockdown withholds one incident's boards and records from guest grants; members and participating organizations keep their access.</p>
      <div className="incidents-filter">
        <EnumSelect label="Archived incidents" values={["exclude", "include", "only"]} value={archived}
          onChange={(value) => setArchived(value as IncidentArchiveFilter)}
          labels={{ exclude: "Hide archived", include: "Show archived too", only: "Archived only" }} />
      </div>
      <OperationalTable tableId="incident-master-view" caption="Incidents in this jurisdiction" columns={columns} rows={rows}
        rowId={(row) => row.id} datasetKey={`${props.jurisdictionId}:${archived}`} status={status}
        errorMessage={response.error ?? "The master view could not be loaded."} onRetry={response.reload}
        emptyTitle={archived === "only" ? "No archived incidents" : "No incidents"}
        emptyDescription={archived === "only" ? "An administrator archives a closed incident from this view." : "Activate an incident to see it here."}
        viewState={tableState} onViewStateChange={setTableState} totalRows={null} hasPreviousPage={false} hasNextPage={false}
        selectedIds={selected} onSelectionChange={setSelected} {...(loadMore ? { onLoadMore: loadMore } : {})} />
    </div>
  </Panel>;
}

/**
 * Collaboration channels and meetings for one incident, where their
 * integration runs. Both engines answer members of the incident's own
 * jurisdiction only, so a participant from elsewhere sees neither.
 */
function IntegrationActions(props: {
  client: ApiClient;
  integrations: ReadonlySet<string> | undefined;
  memberships: readonly Membership[] | undefined;
  incident: { id: string; jurisdictionId: string; name: string; closedAt: string | null };
}) {
  const { incident } = props;
  const role = props.memberships?.find((m) => m.jurisdictionId === incident.jurisdictionId)?.role;
  if (!role) return null;
  const canWrite = role === "admin" || role === "member";
  const closed = Boolean(incident.closedAt);
  return <>
    {props.integrations?.has("collab") ? <IncidentCollaboration client={props.client} jurisdictionId={incident.jurisdictionId}
      incidentId={incident.id} incidentName={incident.name} canAdmin={role === "admin"} canWrite={canWrite} closed={closed} /> : null}
    {props.integrations?.has("meetings") ? <IncidentMeetings client={props.client} incidentId={incident.id}
      incidentName={incident.name} canWrite={canWrite} closed={closed} /> : null}
  </>;
}

const listed = (items: readonly string[]) => items.length ? `: ${items.join("; ")}` : "";

/**
 * What closing an incident leaves running: the open requests and tasks, which
 * stay readable and stop taking steps; the participant grants still in force,
 * which keep their read; and the datasets, which keep updating.
 */
function CloseoutSummary(props: { readonly client: ApiClient; readonly incidentId: string }) {
  const closeout = useAsync(() => props.client.incidentCloseout(props.incidentId), [props.incidentId]);
  if (closeout.error) return <ErrorNote message={closeout.error} />;
  const data = closeout.data;
  if (!data) return <Loading label="Reading what closing leaves running…" />;
  return (
    <section aria-label="What closing leaves running" className="incidents-closeout">
      <p className="eoc-flush">Closing stops new updates. Everything recorded stays readable under the same access, and the incident stays in the incident lists marked closed until an administrator archives it. An administrator can reopen it, giving a reason.</p>
      <ul>
        <li>Open resource requests ({data.openRequests.length}) stay readable and stop taking steps{listed(data.openRequests.map((request) => `REQ-${request.number} ${request.item}`))}.</li>
        <li>Tasks not completed ({data.openTasks.length}) stay readable and stop taking steps{listed(data.openTasks.map((task) => `TASK-${task.number} ${task.item}`))}.</li>
        <li>Participant grants in force ({data.activeGrants.length}) keep their read until revoked or expired{listed(data.activeGrants.map((grant) => `${grant.person}, ${grant.organization}, until ${formatTime(grant.expiresAt)}`))}. End them under Participants if their access should end now.</li>
        <li>Datasets registered for the incident ({data.datasets}) keep updating.</li>
      </ul>
    </section>
  );
}
