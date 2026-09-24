import { useEffect, useState } from "react";
import {
  choiceLabel,
  DEMOBILIZATION_CHECK_LABELS,
  DEMOBILIZATION_CHECKS,
  RESOURCE_REQUEST_TRANSITIONS,
  RESOURCE_RETURN_CONDITIONS,
  RESOURCE_STATUS_TRANSITIONS,
  typeSatisfies,
  type PoolResource,
  type ResourceKind,
  type ResourceRequestAssignment,
} from "@openeoc/shared";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../../design/components.js";
import { Icon } from "../../design/icons/Icon.js";
import { ResourceRequestDetailPanel } from "../../resources/ResourceRequestDetail.js";
import type { ApiClient, ResourceRequestSummary } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { ErrorNote, Loading, Scroll, SurfaceHeader } from "../screens/parts.js";
import "../../resources/resources.css";

const PRIORITIES = ["routine", "priority", "immediate"];
const PRIORITY_LABELS = Object.fromEntries(PRIORITIES.map((value) => [value, choiceLabel(value)]));

type BadgeStatus = "info" | "warning" | "success" | "unknown";
function stateStatus(state: string): BadgeStatus {
  if (state === "closed") return "success";
  if (state === "cancelled") return "unknown";
  if (state === "submitted" || state === "triaged") return "warning";
  return "info";
}

function assignmentLabel(request: ResourceRequestSummary): string {
  if (!request.assignment) return "Unassigned";
  if (request.assignment.kind === "position") return `${request.assignment.positionTitle} · ${request.assignment.organization.name}`;
  return `${request.assignment.personName} · ${request.assignment.incidentPositionTitle} · ${request.assignment.organization.name}`;
}

function RequestRow(props: {
  req: ResourceRequestSummary;
  kindText: string;
  positions: readonly { id: string; title: string }[];
  participants: readonly { id: string; personName: string; incidentPositionTitle: string; organizationName: string }[];
  incidentId: string | null;
  canMutate: boolean;
  busy: boolean;
  onAdvance: (id: string, toState: string, note: string) => void;
  onAssign: (id: string, assignment: ResourceRequestAssignment) => void;
  onHistory: (id: string) => void;
}) {
  const nexts = RESOURCE_REQUEST_TRANSITIONS[props.req.state] ?? [];
  const [to, setTo] = useState<string>(nexts[0] ?? "");
  const [note, setNote] = useState("");
  const [target, setTarget] = useState("");
  const needsAssignment = props.req.state === "sourcing";
  const transitions = needsAssignment ? nexts.filter((state) => state !== "assigned") : nexts;
  useEffect(() => setTo((RESOURCE_REQUEST_TRANSITIONS[props.req.state] ?? [])[0] ?? ""), [props.req.state]);
  const assign = () => {
    const [kind, id] = target.split(":", 2);
    if (kind === "position" && id) props.onAssign(props.req.id, { kind, positionId: id });
    if (kind === "participant" && id && props.incidentId) {
      props.onAssign(props.req.id, { kind: "incident_participant", incidentId: props.incidentId, participantId: id });
    }
  };
  return (
    <li className="resources-request">
      <div className="resources-request-body">
        <div className="resources-row"><StatusBadge status={stateStatus(props.req.state)}>{choiceLabel(props.req.state)}</StatusBadge><span className="eoc-muted">REQ-{props.req.number}</span><strong>{props.req.item}</strong><span className="eoc-muted">×{props.req.quantity}</span><span className="eoc-muted">Priority: {choiceLabel(props.req.priority)}</span>{props.req.neededBy ? <span className="eoc-muted">Needed by {new Date(props.req.neededBy).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</span> : null}</div>
        <div className="resources-request-facts"><span>Receiving: {props.req.receivingOrganization.name}</span><span>Supplying: {props.req.supplyingOrganization?.name ?? "Not identified"}</span><span>Owner: {assignmentLabel(props.req)}</span>{props.kindText ? <span>Kind: {props.kindText}</span> : null}</div>
        {props.canMutate && needsAssignment ? <div className="resources-assign"><div className="resources-assign-form"><label className="resources-label">Assign to named authority<select aria-label={`Assignment for ${props.req.item}`} value={target} onChange={(event) => setTarget(event.target.value)} className="resources-select"><option value="">Choose a position or incident participant</option>{props.positions.length ? <optgroup label="Positions">{props.positions.map((position) => <option key={position.id} value={`position:${position.id}`}>{position.title}</option>)}</optgroup> : null}{props.participants.length ? <optgroup label="Incident participants">{props.participants.map((participant) => <option key={participant.id} value={`participant:${participant.id}`}>{participant.personName} · {participant.incidentPositionTitle} · {participant.organizationName}</option>)}</optgroup> : null}</select></label><Button kind="primary" onClick={assign} disabled={props.busy || !target}>Assign and advance</Button></div>{props.positions.length === 0 && props.participants.length === 0 ? <span role="status" className="eoc-muted">No eligible position or active incident participant is available for assignment.</span> : null}</div> : null}
        {props.canMutate && transitions.length ? <div className="resources-assign-form"><label className="resources-label">Next action<select aria-label={`Next state for ${props.req.item}`} value={to} onChange={(event) => setTo(event.target.value)} className="resources-select">{transitions.map((state) => <option key={state} value={state}>{choiceLabel(state)}</option>)}</select></label><div className="resources-cell"><TextField label="Transition note" value={note} onChange={setNote} /></div><Button onClick={() => props.onAdvance(props.req.id, to, note)} disabled={props.busy || !to}>Advance</Button></div> : !needsAssignment ? <span className="eoc-muted">{props.canMutate ? "Lifecycle complete" : "Read-only request"}</span> : !props.canMutate ? <span className="eoc-muted">Read-only request</span> : null}
      </div>
      <Button onClick={() => props.onHistory(props.req.id)} disabled={props.busy}>History</Button>
    </li>
  );
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Dollars as typed ("5,400.00", "$96.05") to whole cents; null when unreadable. */
function toCents(value: string): number | null {
  const plain = value.replace(/[$,\s]/g, "");
  return /^\d+(\.\d{1,2})?$/.test(plain) ? Math.round(Number(plain) * 100) : null;
}

/**
 * Reimbursement costs and escalation for the selected request. Escalation
 * hands the request to a higher tier over the peer token that tier issued;
 * the tier works it as its own request and its status reports land in this
 * request's history.
 */
function RequestCostsAndEscalation(props: {
  client: ApiClient;
  request: ResourceRequestSummary;
  canMutate: boolean;
  onEscalated: () => void;
  onCostRecorded: () => void;
}) {
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [incurredOn, setIncurredOn] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [peerName, setPeerName] = useState("");
  const [peerBaseUrl, setPeerBaseUrl] = useState("");
  const [peerToken, setPeerToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = props.request.state !== "closed" && props.request.state !== "cancelled";

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      setNotice(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const recordCost = () => run(async () => {
    const cents = toCents(amount);
    if (!category.trim()) throw new Error("Enter a cost category.");
    if (cents === null) throw new Error("Enter the amount in dollars, for example 5400.00.");
    if (!incurredOn) throw new Error("Enter the date the cost was incurred.");
    await props.client.addResourceRequestCost(props.request.id, {
      category: category.trim(),
      amountCents: cents,
      incurredAt: incurredOn,
      ...(description.trim() ? { description: description.trim() } : {}),
    });
    setCategory("");
    setAmount("");
    setDescription("");
    props.onCostRecorded();
    return `Cost recorded: ${category.trim()}, $${(cents / 100).toFixed(2)}.`;
  });
  const exportCosts = () => run(async () => {
    saveBlob(await props.client.exportResourceRequestCosts(props.request.id), `resource-request-${props.request.id.slice(0, 8)}-costs.csv`);
    return null;
  });
  const escalate = () => run(async () => {
    const name = peerName.trim();
    if (!name || !peerBaseUrl.trim() || !peerToken) throw new Error("Enter the peer name, its address and the peer token it issued.");
    await props.client.escalateResourceRequest(props.request.id, { peerName: name, peerBaseUrl: peerBaseUrl.trim(), peerToken });
    setPeerToken("");
    props.onEscalated();
    return `Escalated to ${name}. Status reports from ${name} appear in the request history.`;
  });

  return (
    <Panel title={`${props.request.item}: costs and mutual aid`}>
      <div className="resources-panel-body">
        <section aria-label="Reimbursement costs" className="resources-part">
          <h3 className="eoc-flush">Reimbursement costs</h3>
          {props.canMutate ? <div className="resources-form">
            <div className="resources-cell"><TextField label="Cost category" value={category} onChange={setCategory} /></div>
            <div className="resources-cell"><TextField label="Amount (USD)" value={amount} onChange={setAmount} /></div>
            <div className="resources-cell"><TextField label="Cost description" value={description} onChange={setDescription} /></div>
            <label className="resources-label">Incurred on<input type="date" value={incurredOn} onChange={(event) => setIncurredOn(event.target.value)} className="resources-select" /></label>
            <Button kind="primary" onClick={() => void recordCost()} disabled={busy}>Record cost</Button>
          </div> : null}
          <div><Button onClick={() => void exportCosts()} disabled={busy}>Export costs (CSV)</Button></div>
        </section>
        {props.canMutate && open ? <section aria-label="Escalate to another tier" className="resources-part">
          <h3 className="eoc-flush">Escalate to another tier</h3>
          <p className="eoc-flush eoc-muted">Use the peer token the receiving tier issued when it registered this organization. The token is sent once and not stored.</p>
          <div className="resources-form">
            <div className="resources-cell"><TextField label="Peer name" value={peerName} onChange={setPeerName} /></div>
            <div className="resources-cell"><TextField label="Peer address" value={peerBaseUrl} onChange={setPeerBaseUrl} /></div>
            <div className="resources-cell"><TextField label="Peer token" type="password" value={peerToken} onChange={setPeerToken} /></div>
            <Button onClick={() => void escalate()} disabled={busy}>Escalate request</Button>
          </div>
        </section> : null}
        {notice ? <p role="status" className="eoc-flush eoc-text-success">{notice}</p> : null}
        {error ? <p role="alert" className="eoc-flush eoc-text-critical">{error}</p> : null}
      </div>
    </Panel>
  );
}

const plain = (value: string) => value.replaceAll("_", " ");
const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** "Engine, Type 3", the kind's name when the catalog has it, else its key. */
function kindText(kinds: readonly ResourceKind[], key: string | null, type: number | null): string {
  if (!key) return "";
  const name = kinds.find((kind) => kind.key === key)?.name ?? key;
  return type === null ? name : `${name}, Type ${type}`;
}

/** Kind and type pickers. A request may leave both open; a pool resource names one definite type. */
function KindTypeFields(props: {
  kinds: readonly ResourceKind[];
  kind: string;
  type: string;
  onKind: (kind: string) => void;
  onType: (type: string) => void;
  forRequest: boolean;
}) {
  const types = (props.kinds.find((kind) => kind.key === props.kind)?.levels ?? []).map((level) => String(level.type));
  return (
    <>
      <div className="resources-cell"><EnumSelect
        label="Resource kind"
        values={["", ...props.kinds.map((kind) => kind.key)]}
        labels={{ "": props.forRequest ? "Not typed" : "Choose a kind", ...Object.fromEntries(props.kinds.map((kind) => [kind.key, kind.name])) }}
        value={props.kind}
        onChange={(kind) => { props.onKind(kind); props.onType(""); }}
      /></div>
      {types.length ? <div className="resources-cell"><EnumSelect
        label="Resource type"
        values={["", ...types]}
        labels={{ "": props.forRequest ? "Any type" : "Choose a type", ...Object.fromEntries(types.map((type) => [type, `Type ${type}`])) }}
        value={props.type}
        onChange={props.onType}
      /></div> : null}
    </>
  );
}

const poolBadge: Record<string, BadgeStatus> = { available: "success", assigned: "info", out_of_service: "warning", demobilized: "unknown" };

function PoolRow(props: {
  resource: PoolResource;
  kinds: readonly ResourceKind[];
  requests: readonly ResourceRequestSummary[];
  canMutate: boolean;
  busy: boolean;
  onMove: (id: string, move: { to: string; requestId?: string; returnCondition?: string; checks?: string[] }) => void;
}) {
  const r = props.resource;
  const nexts = RESOURCE_STATUS_TRANSITIONS[r.status] ?? [];
  const [to, setTo] = useState(nexts[0] ?? "");
  const [requestId, setRequestId] = useState("");
  const [condition, setCondition] = useState("ready");
  const [checks, setChecks] = useState<string[]>([]);
  useEffect(() => setTo((RESOURCE_STATUS_TRANSITIONS[r.status] ?? [])[0] ?? ""), [r.status]);
  const eligible = props.requests.filter((q) => ["sourcing", "assigned", "deployed"].includes(q.state)
    && q.resourceKind === r.kind && typeSatisfies(r.type, q.resourceType));
  const apply = () => props.onMove(r.id, to === "assigned" ? { to, requestId }
    : to === "demobilized" ? { to, returnCondition: condition, checks } : { to });
  return (
    <li className="resources-pool-item">
      <div className="resources-row">
        <StatusBadge status={poolBadge[r.status] ?? "unknown"}>{plain(r.status)}</StatusBadge>
        <strong>{r.name}</strong>
        <span className="eoc-muted">{kindText(props.kinds, r.kind, r.type)}</span>
      </div>
      {r.request ? <span className="eoc-flush eoc-muted">Assigned to request: {r.request.item}</span> : null}
      {r.status === "demobilized" ? <span className="eoc-flush eoc-muted">
        Returned {plain(r.returnCondition ?? "")}. Checks made: {r.demobilizationChecks.length
          ? r.demobilizationChecks.map((check) => DEMOBILIZATION_CHECK_LABELS[check] ?? check).join("; ") : "none"}.
      </span> : null}
      {props.canMutate && nexts.length ? <div className="resources-form">
        <label className="resources-label">Next status<select aria-label={`Next status for ${r.name}`} value={to} onChange={(event) => setTo(event.target.value)} className="resources-select">{nexts.map((status) => <option key={status} value={status}>{plain(status)}</option>)}</select></label>
        {to === "assigned" ? <label className="resources-label">Matching request<select aria-label={`Request for ${r.name}`} value={requestId} onChange={(event) => setRequestId(event.target.value)} className="resources-select"><option value="">{eligible.length ? "Choose a request" : "No open request of this kind and type"}</option>{eligible.map((q) => <option key={q.id} value={q.id}>{q.item} ({kindText(props.kinds, q.resourceKind, q.resourceType)})</option>)}</select></label> : null}
        {to === "demobilized" ? <label className="resources-label">Return condition<select aria-label={`Return condition for ${r.name}`} value={condition} onChange={(event) => setCondition(event.target.value)} className="resources-select">{RESOURCE_RETURN_CONDITIONS.values.map((value) => <option key={value} value={value}>{plain(value)}</option>)}</select></label> : null}
        {to === "demobilized" ? <fieldset className="resources-checks">
          <legend>Demobilization checks for {r.name}</legend>
          {DEMOBILIZATION_CHECKS.values.map((check) => <label key={check} className="eoc-check">
            <input type="checkbox" checked={checks.includes(check)} onChange={(event) => setChecks(event.target.checked ? [...checks, check] : checks.filter((c) => c !== check))} />
            {DEMOBILIZATION_CHECK_LABELS[check]}
          </label>)}
        </fieldset> : null}
        <Button onClick={apply} disabled={props.busy || !to || (to === "assigned" && !requestId)}>Update status</Button>
      </div> : null}
    </li>
  );
}

/** The jurisdiction's pool of typed resources: add one, assign it to a matching request, take it out of service, demobilize it. */
function ResourcePool(props: {
  client: ApiClient;
  jurisdictionId: string;
  kinds: readonly ResourceKind[];
  requests: readonly ResourceRequestSummary[];
  canMutate: boolean;
}) {
  const pool = useAsync(() => props.client.listResources(props.jurisdictionId), [props.jurisdictionId]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [type, setType] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      pool.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const add = () => run(async () => {
    if (!name.trim() || !kind) throw new Error("Enter the resource name and choose its kind.");
    await props.client.addResource(props.jurisdictionId, { name: name.trim(), kind, type: type ? Number(type) : null });
    setName("");
  });
  const list = pool.data ?? [];
  return (
    <Panel title="Resource pool">
      <div className="resources-stack">
        {props.canMutate ? <div className="resources-form">
          <div className="resources-cell"><TextField label="Resource name" value={name} onChange={setName} /></div>
          <KindTypeFields kinds={props.kinds} kind={kind} type={type} onKind={setKind} onType={setType} forRequest={false} />
          <Button kind="primary" onClick={() => void add()} disabled={busy}>Add to pool</Button>
        </div> : null}
        {pool.loading && !pool.data ? <Loading label="Loading the resource pool…" /> : null}
        {pool.error && !pool.data ? <ErrorNote message={pool.error} /> : null}
        {pool.data && list.length === 0 ? <p className="eoc-flush eoc-muted">No resources in the pool.</p> : null}
        {list.length ? <ul className="resources-list">
          {list.map((resource) => <PoolRow key={resource.id} resource={resource} kinds={props.kinds} requests={props.requests}
            canMutate={props.canMutate} busy={busy} onMove={(id, move) => void run(() => props.client.transitionResource(id, move))} />)}
        </ul> : null}
        {error ? <p role="alert" className="eoc-flush eoc-text-critical">{error}</p> : null}
      </div>
    </Panel>
  );
}

/** Recorded costs of the requests in scope, from the request list, with a total per kind. */
function CostRollup(props: {
  kinds: readonly ResourceKind[];
  requests: readonly ResourceRequestSummary[];
  incidentScoped: boolean;
}) {
  const costed = props.requests.filter((request) => request.costCents > 0);
  const label = (request: ResourceRequestSummary) => kindText(props.kinds, request.resourceKind, null) || "Not typed";
  const byKind = new Map<string, number>();
  for (const request of costed) byKind.set(label(request), (byKind.get(label(request)) ?? 0) + request.costCents);
  const total = costed.reduce((sum, request) => sum + request.costCents, 0);
  return (
    <Panel title="Cost rollup">
      <p className="resources-lead">{props.incidentScoped ? "Costs recorded on this incident's requests." : "Costs recorded on every request of the organization."} Record and export a request's costs from its history.</p>
      {costed.length === 0 ? <p className="eoc-flush eoc-muted">No costs recorded in this scope.</p> : <div className="resources-scroll">
        <table className="resources-table">
          <thead><tr><th scope="col">Request</th><th scope="col">Kind</th><th scope="col">Recorded</th></tr></thead>
          <tbody>{costed.map((request) => <tr key={request.id}>
            <td>{request.item}</td>
            <td>{kindText(props.kinds, request.resourceKind, request.resourceType) || "Not typed"}</td>
            <td>{usd(request.costCents)}</td>
          </tr>)}</tbody>
          <tfoot>
            {[...byKind].map(([kind, cents]) => <tr key={kind}><th scope="row" colSpan={2}>{kind} total</th><td>{usd(cents)}</td></tr>)}
            <tr><th scope="row" colSpan={2}>All requests</th><td><strong>{usd(total)}</strong></td></tr>
          </tfoot>
        </table>
      </div>}
    </Panel>
  );
}

const sourceText = (kind: ResourceKind) => kind.source === "seed" ? "Starter" : kind.source === "local" ? "Local" : `RTLT ${kind.rtltId ?? ""}`;

/** The NIMS typing catalog: starter kinds, local kinds and RTLT definitions; administrators add and import. */
function TypingCatalog(props: {
  client: ApiClient;
  jurisdictionId: string;
  kinds: readonly ResourceKind[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [levelCount, setLevelCount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sourceNote, setSourceNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      setNotice(await action());
      props.onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const addKind = () => run(async () => {
    const count = levelCount.trim() === "" ? 0 : Number(levelCount);
    if (!name.trim()) throw new Error("Enter the name of the kind.");
    if (!Number.isInteger(count) || count < 0 || count > 10) throw new Error("Enter from 1 to 10 type levels, or leave it blank for a single type.");
    await props.client.addResourceKind(props.jurisdictionId, {
      name: name.trim(), discipline: discipline.trim(), notes: "",
      levels: Array.from({ length: count }, (_, index) => ({ type: index + 1, capability: "" })),
    });
    setName("");
    setDiscipline("");
    setLevelCount("");
    return `Added ${name.trim()} to the catalog.`;
  });
  const importFile = () => run(async () => {
    if (!file) throw new Error("Choose the RTLT export file.");
    if (!sourceNote.trim()) throw new Error("Say where the file came from.");
    const result = await props.client.importResourceKinds(props.jurisdictionId, { csv: await file.text(), sourceNote: sourceNote.trim() });
    return `Imported ${result.imported} definitions from the RTLT export.`;
  });
  return (
    <Panel title="Resource typing catalog">
      <div className="resources-stack">
        <p className="eoc-flush eoc-muted">NIMS resource typing: Type 1 is the most capable. The starter kinds are a small subset; import the FEMA Resource Typing Library Tool (RTLT) export for the authoritative catalog.</p>
        <details>
          <summary>Show the {props.kinds.length} kinds</summary>
          <div className="resources-scroll is-below">
            <table className="resources-table">
              <thead><tr><th scope="col">Kind</th><th scope="col">Discipline</th><th scope="col">Types</th><th scope="col">Source</th></tr></thead>
              <tbody>{props.kinds.map((kind) => <tr key={kind.key}>
                <td>{kind.name}</td>
                <td>{kind.discipline}</td>
                <td>{kind.levels.length === 0 ? "Single type" : kind.levels.map((level) => level.capability ? `Type ${level.type}: ${level.capability}` : `Type ${level.type}`).join("; ")}</td>
                <td title={kind.sourceNote}>{sourceText(kind)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </details>
        {props.canManage ? <section aria-label="Add a local kind" className="resources-part">
          <h3 className="eoc-flush">Add a local kind</h3>
          <div className="resources-form">
            <div className="resources-cell"><TextField label="Kind name" value={name} onChange={setName} /></div>
            <div className="resources-cell"><TextField label="Discipline" value={discipline} onChange={setDiscipline} /></div>
            <div className="resources-cell"><TextField label="Type levels (blank for a single type)" value={levelCount} onChange={setLevelCount} /></div>
            <Button onClick={() => void addKind()} disabled={busy}>Add kind</Button>
          </div>
        </section> : null}
        {props.canManage ? <section aria-label="Import RTLT definitions" className="resources-part">
          <h3 className="eoc-flush">Import RTLT definitions</h3>
          <p className="eoc-flush eoc-muted">A CSV with a name, an RTLT ID and a type level per row. Every row imports or none does, and the import replaces the previous one.</p>
          <div className="resources-form">
            <label className="resources-label">RTLT export (CSV)<input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="resources-select" /></label>
            <div className="resources-cell"><TextField label="Where the file came from" value={sourceNote} onChange={setSourceNote} /></div>
            <Button onClick={() => void importFile()} disabled={busy}>Import definitions</Button>
          </div>
        </section> : null}
        {notice ? <p role="status" className="eoc-flush eoc-text-success">{notice}</p> : null}
        {error ? <p role="alert" className="eoc-flush eoc-text-critical">{error}</p> : null}
      </div>
    </Panel>
  );
}

/**
 * The 213RR resource-request board (F5). Submit a request, and move each one
 * through the NIMS ordering lifecycle; the allowed next states come straight
 * from the dictionary transition table, so the UI can never offer an illegal
 * move (the server enforces the same table).
 */
export function ResourcesSurface(props: {
  client: ApiClient;
  jurisdictionId: string;
  incidentId: string | null;
  selectedRequestId?: string | null;
  onSelectRequest?: (id: string | null) => void;
  canMutate?: boolean;
  closed?: boolean;
}) {
  const requests = useAsync(
    () => props.client.listResourceRequests(props.jurisdictionId, props.incidentId),
    [props.jurisdictionId, props.incidentId],
  );
  const positions = useAsync(() => props.client.listPositions(props.jurisdictionId), [props.jurisdictionId]);
  const participants = useAsync(
    () => props.incidentId ? props.client.listIncidentParticipants(props.incidentId) : Promise.resolve([]),
    [props.incidentId],
  );
  const catalog = useAsync(() => props.client.listResourceKinds(props.jurisdictionId), [props.jurisdictionId]);
  const kinds = catalog.data?.kinds ?? [];
  const [item, setItem] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [priority, setPriority] = useState("routine");
  const [notes, setNotes] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [requestKind, setRequestKind] = useState("");
  const [requestType, setRequestType] = useState("");
  const [selectedRequest, setSelectedRequest] = useState<string | null>(props.selectedRequestId ?? null);
  useEffect(() => {
    if (props.selectedRequestId !== undefined) setSelectedRequest(props.selectedRequestId);
  }, [props.selectedRequestId]);
  const selectRequest = (id: string | null) => {
    setSelectedRequest(id);
    props.onSelectRequest?.(id);
  };
  const detail = useAsync(
    () => selectedRequest ? props.client.getResourceRequest(selectedRequest) : Promise.resolve(null),
    [selectedRequest],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      requests.reload();
      if (selectedRequest) detail.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    run(async () => {
      if (!item.trim()) throw new Error("Enter a requested item.");
      await props.client.submitResourceRequest(props.jurisdictionId, {
        origin: "eoc",
        item: item.trim(),
        quantity: Number(quantity) || 1,
        priority,
        ...(neededBy ? { neededBy: new Date(neededBy).toISOString() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        // Tag the request to the working incident so it lists in that context;
        // with no incident selected it stays a jurisdiction-wide request (79B2).
        ...(props.incidentId ? { incidentId: props.incidentId } : {}),
        ...(requestKind ? { resourceKind: requestKind } : {}),
        ...(requestType ? { resourceType: Number(requestType) } : {}),
      });
      setItem("");
      setQuantity("1");
      setNotes("");
      setNeededBy("");
      setRequestKind("");
      setRequestType("");
    });

  const list = requests.data ?? [];
  const canMutate = (props.canMutate ?? true) && !props.closed;
  const activeParticipants = (participants.data ?? []).filter((participant) =>
    !participant.revokedAt
    && new Date(participant.expiresAt).getTime() > Date.now()
    && participant.organizationId !== props.jurisdictionId
    && (participant.role === "contributor" || participant.role === "coordinator"));

  return (
    <Scroll>
      <SurfaceHeader title="Resource coordination" />
      <div className="resources-page">
        <Panel title="Request intake">
          <div className="resources-kicker"><Icon name="resources" decorative size={20} /><strong>ICS 213RR coordination</strong></div>
          <p className="resources-first eoc-muted">The receiving organization owns the request. A supplier is named only when an authorized position or incident participant accepts the assignment.</p>
          {props.incidentId ? <p className="resources-first eoc-muted">This intake is linked to the selected incident; the request history retains every lifecycle action.</p> : null}
          {canMutate ? <><div className="resources-intake">
            <div className="resources-cell"><TextField label="Requested item" value={item} onChange={setItem} /></div>
            <div className="resources-cell"><TextField label="Quantity" value={quantity} onChange={setQuantity} /></div>
            <div className="resources-cell"><EnumSelect label="Priority" values={PRIORITIES} labels={PRIORITY_LABELS} value={priority} onChange={setPriority} /></div>
            <div className="resources-cell"><label className="resources-label">Needed by<input type="datetime-local" className="resources-select" value={neededBy} onChange={(event) => setNeededBy(event.target.value)} /></label></div>
            <div className="resources-cell"><TextField label="Request notes" value={notes} onChange={setNotes} /></div>
            <KindTypeFields kinds={kinds} kind={requestKind} type={requestType} onKind={setRequestKind} onType={setRequestType} forRequest />
          </div><div className="eoc-space-above"><Button kind="primary" onClick={submit} disabled={busy}>Submit request</Button></div></> : <p role="status" className="resources-last eoc-muted">{props.closed ? "This incident is closed. Request history remains available." : "Your access is read-only. Request history remains available."}</p>}
        </Panel>

        <Panel title="Requests and next actions">
          {requests.loading && !requests.data ? <Loading label="Loading requests…" /> : null}
          {requests.error && !requests.data ? <ErrorNote message={requests.error} /> : null}
          {requests.data && list.length === 0 ? (
            <p className="eoc-flush eoc-muted">No resource requests in this scope.</p>
          ) : null}
          {list.length > 0 ? (
            <ul className="resources-list">
              {list.map((r) => (
                <RequestRow
                  key={r.id}
                  req={r}
                  kindText={kindText(kinds, r.resourceKind, r.resourceType)}
                  positions={positions.data ?? []}
                  participants={activeParticipants}
                  incidentId={props.incidentId}
                  canMutate={canMutate}
                  busy={busy}
                  onHistory={selectRequest}
                  onAdvance={(id, toState, note) => run(() => props.client.transitionResourceRequest(id, toState, note))}
                  onAssign={(id, assignment) => run(() => props.client.assignResourceRequest(id, assignment))}
                />
              ))}
            </ul>
          ) : null}
        </Panel>

        {detail.loading && selectedRequest ? <Loading label="Loading request history…" /> : null}
        {detail.error ? <ErrorNote message={detail.error} /> : null}
        {detail.data ? <ResourceRequestDetailPanel detail={detail.data} onClose={() => selectRequest(null)} /> : null}
        {detail.data ? (
          <RequestCostsAndEscalation
            key={detail.data.id}
            client={props.client}
            request={detail.data}
            canMutate={canMutate}
            onEscalated={detail.reload}
            onCostRecorded={requests.reload}
          />
        ) : null}

        {error ? (
          <p role="alert" className="eoc-text-critical">
            {error}
          </p>
        ) : null}

        <ResourcePool client={props.client} jurisdictionId={props.jurisdictionId} kinds={kinds} requests={list} canMutate={props.canMutate ?? true} />
        <CostRollup kinds={kinds} requests={list} incidentScoped={props.incidentId !== null} />
        {catalog.error && !catalog.data ? <ErrorNote message={catalog.error} /> : null}
        {catalog.data ? <TypingCatalog client={props.client} jurisdictionId={props.jurisdictionId} kinds={kinds}
          canManage={catalog.data.canManage} onChanged={catalog.reload} /> : null}
      </div>
    </Scroll>
  );
}
