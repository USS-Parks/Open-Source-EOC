import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  choiceLabel,
  DEMOBILIZATION_CHECK_LABELS,
  DEMOBILIZATION_CHECKS,
  RESOURCE_REQUEST_DELIVERY_STEPS,
  RESOURCE_REQUEST_ENDED,
  RESOURCE_REQUEST_REASON_REQUIRED,
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
import { canReadCodes, QrCode, readCodeFromImage } from "../../design/qr.js";
import { WorkStateLine, type WorkState } from "../../design/work-state.js";
import { useDraftStore } from "../../offline/draft-store.js";
import { ResourceRequestDetailPanel } from "../../resources/ResourceRequestDetail.js";
import { nextAction, ownerLabel, requestStage, stageTone, when } from "../../resources/request-view.js";
import type { ApiClient, ResourceHistoryEntry, ResourceRequestSummary } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { ErrorNote, Loading, Scroll, SurfaceHeader } from "../screens/parts.js";
import "../../resources/resources.css";

const PRIORITIES = ["routine", "priority", "immediate"];
const PRIORITY_LABELS = Object.fromEntries(PRIORITIES.map((value) => [value, choiceLabel(value)]));

/** What each move is called on its button. Decline and cancel ask for a reason first. */
const ACTION_VERBS: Readonly<Record<string, string>> = {
  submitted: "Submit", accepted: "Accept", sourcing: "Start sourcing", assigned: "Mark assigned",
  deployed: "Mark deployed", fulfilled: "Mark fulfilled", demobilizing: "Start demobilizing", closed: "Close",
  declined: "Decline", cancelled: "Cancel request",
};

function RequestRow(props: {
  req: ResourceRequestSummary;
  kindText: string;
  positions: readonly { id: string; title: string }[];
  participants: readonly { id: string; personName: string; incidentPositionTitle: string; organizationName: string }[];
  incidentId: string | null;
  canMutate: boolean;
  /** The viewer holds the incident grant the request is assigned to, outside its owner: delivery steps only. */
  assignee?: boolean;
  busy: boolean;
  onAdvance: (id: string, toState: string, note: string) => void;
  onAssign: (id: string, assignment: ResourceRequestAssignment) => void;
  onOpen: (id: string) => void;
}) {
  const { req } = props;
  const delivery = RESOURCE_REQUEST_DELIVERY_STEPS[req.state as keyof typeof RESOURCE_REQUEST_DELIVERY_STEPS];
  const nexts = props.assignee ? (delivery ? [delivery] : []) : RESOURCE_REQUEST_TRANSITIONS[req.state] ?? [];
  const needsAssignment = req.state === "sourcing";
  const transitions = needsAssignment ? nexts.filter((state) => state !== "assigned") : nexts;
  const steps = transitions.filter((state) => !RESOURCE_REQUEST_REASON_REQUIRED.includes(state));
  const endings = transitions.filter((state) => RESOURCE_REQUEST_REASON_REQUIRED.includes(state));
  const [note, setNote] = useState("");
  const [ending, setEnding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState("");
  // A move clears the half-written reason and note; mounting does not, or a
  // click that lands before the mount's effect runs would be undone by it.
  const shownState = useRef(req.state);
  useEffect(() => {
    if (shownState.current === req.state) return;
    shownState.current = req.state;
    setEnding(null);
    setNote("");
  }, [req.state]);
  const number = `REQ-${req.number}`;
  const assign = () => {
    const [kind, id] = target.split(":", 2);
    if (kind === "position" && id) props.onAssign(req.id, { kind, positionId: id });
    if (kind === "participant" && id && props.incidentId) {
      props.onAssign(req.id, { kind: "incident_participant", incidentId: props.incidentId, participantId: id });
    }
  };
  const acting = props.canMutate || props.assignee;
  return (
    <li className="resources-request" aria-label={`${number} ${req.item}`}>
      <div className="resources-request-body">
        <div className="resources-row"><StatusBadge status={stageTone(req.state)}>{requestStage(req.state)}</StatusBadge><strong>{number}</strong><strong>{req.item}</strong><span className="eoc-muted">×{req.quantity}</span><span className="eoc-muted">Priority: {choiceLabel(req.priority)}</span>{req.neededBy ? <span className="eoc-muted">Needed by {when(req.neededBy)}</span> : null}</div>
        <div className="resources-request-facts">
          <span>Received {when(req.createdAt)}{req.requestedByName ? ` from ${req.requestedByName}` : ""} · sent to {req.receivingOrganization.name}</span>
          <span>Owner: {ownerLabel(req)}</span>
          <span>Next: {nextAction(req.state) ?? "None; the request has ended"}</span>
          <span>Supplying: {req.supplyingOrganization?.name ?? "Not identified"}</span>
          {props.kindText ? <span>Kind: {props.kindText}</span> : null}
        </div>
        {props.canMutate && !props.assignee && needsAssignment ? <div className="resources-assign"><div className="resources-assign-form"><label className="resources-label">Assign to named authority<select aria-label={`Assignment for ${req.item}`} value={target} onChange={(event) => setTarget(event.target.value)} className="resources-select"><option value="">Choose a position or incident participant</option>{props.positions.length ? <optgroup label="Positions">{props.positions.map((position) => <option key={position.id} value={`position:${position.id}`}>{position.title}</option>)}</optgroup> : null}{props.participants.length ? <optgroup label="Incident participants">{props.participants.map((participant) => <option key={participant.id} value={`participant:${participant.id}`}>{participant.personName} · {participant.incidentPositionTitle} · {participant.organizationName}</option>)}</optgroup> : null}</select></label><Button kind="primary" onClick={assign} disabled={props.busy || !target}>Assign and advance</Button></div>{props.positions.length === 0 && props.participants.length === 0 ? <span role="status" className="eoc-muted">No eligible position or active incident participant is available for assignment.</span> : null}</div> : null}
        {acting && transitions.length ? (
          <div className="resources-actions">
            {steps.length ? <div className="resources-cell"><TextField label="Note (optional)" value={note} onChange={setNote} /></div> : null}
            {steps.map((state, index) => (
              <Button key={state} kind={index === 0 ? "primary" : "quiet"} disabled={props.busy} label={`${ACTION_VERBS[state] ?? requestStage(state)} ${number}`}
                onClick={() => props.onAdvance(req.id, state, note.trim())}>{ACTION_VERBS[state] ?? requestStage(state)}</Button>
            ))}
            {endings.map((state) => (
              <Button key={state} kind="quiet" disabled={props.busy} label={`${ACTION_VERBS[state]} ${number}`}
                onClick={() => { setEnding(state); setReason(""); }}>{ACTION_VERBS[state]}…</Button>
            ))}
          </div>
        ) : !needsAssignment ? <span className="eoc-muted">{nextAction(req.state) ? "Read-only request" : "Lifecycle complete"}</span> : !props.canMutate ? <span className="eoc-muted">Read-only request</span> : null}
        {ending ? (
          <div className="resources-actions" role="group" aria-label={`${ACTION_VERBS[ending]} ${number}`}>
            <div className="resources-cell"><TextField label="Reason (required)" value={reason} onChange={setReason} /></div>
            <Button kind="primary" disabled={props.busy || !reason.trim()} onClick={() => { props.onAdvance(req.id, ending, reason.trim()); setEnding(null); }}>{ACTION_VERBS[ending]}</Button>
            <Button onClick={() => setEnding(null)}>Keep it</Button>
          </div>
        ) : null}
      </div>
      <Button onClick={() => props.onOpen(req.id)} disabled={props.busy} label={`Open ${number}`}>Open</Button>
    </li>
  );
}

/** The active filters, in words. */
function filterParts(filters: { readonly q: string; readonly status: "open" | "ended" | "all"; readonly mine: boolean }): string[] {
  return [
    ...(filters.status === "open" ? ["open only"] : filters.status === "ended" ? ["closed, declined or cancelled only"] : []),
    ...(filters.q ? [`matching "${filters.q}"`] : []),
    ...(filters.mine ? ["asked for by you"] : []),
  ];
}

/** How many requests are shown and every filter that narrows them. */
function filterSummary(count: number, filters: Parameters<typeof filterParts>[0]): string {
  const parts = filterParts(filters);
  const shown = `${count} ${count === 1 ? "request" : "requests"}`;
  if (parts.length === 0) return `Showing all ${shown}, open and ended.`;
  return count === 0 ? `No request is ${parts.join(", ")}.` : `Showing ${shown}: ${parts.join(", ")}.`;
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
  const open = !RESOURCE_REQUEST_ENDED.includes(props.request.state);

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

/** One line of a pool resource's history. */
function historyText(entry: ResourceHistoryEntry, kinds: readonly ResourceKind[]): string {
  const d = entry.detail as Record<string, unknown>;
  const typeOf = (value: unknown) => (typeof value === "number" ? value : null);
  if (entry.category === "resource.added") return `Added as ${kindText(kinds, String(d.kind ?? ""), typeOf(d.type))}`;
  if (entry.category === "resource.updated") {
    const from = (d.from ?? {}) as Record<string, unknown>;
    const to = (d.to ?? {}) as Record<string, unknown>;
    const parts: string[] = [];
    if (from.name !== to.name) parts.push(`renamed from ${String(from.name)}`);
    if (from.kind !== to.kind || from.type !== to.type)
      parts.push(`changed from ${kindText(kinds, String(from.kind ?? ""), typeOf(from.type))} to ${kindText(kinds, String(to.kind ?? ""), typeOf(to.type))}`);
    return parts.length ? `Edited: ${parts.join("; ")}` : "Edited";
  }
  if (entry.category === "resource.status") {
    const moved = `${choiceLabel(String(d.from ?? ""))} to ${choiceLabel(String(d.to ?? ""))}`;
    return typeof d.returnCondition === "string" ? `${moved}, returned ${plain(d.returnCondition)}` : moved;
  }
  return plain(entry.category.replace(/^resource\./, ""));
}

/** A pool resource's history, read when opened. */
function PoolHistory(props: { client: ApiClient; resourceId: string; name: string; kinds: readonly ResourceKind[]; revision: string }) {
  const [open, setOpen] = useState(false);
  const history = useAsync(() => open ? props.client.resourceHistory(props.resourceId) : Promise.resolve(null),
    [props.client, props.resourceId, open, props.revision]);
  return (
    <details className="resources-history" onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary>History of {props.name}</summary>
      {history.loading && !history.data ? <Loading label="Loading history…" /> : null}
      {history.error ? <ErrorNote message={history.error} /> : null}
      {history.data ? <ol aria-label={`History of ${props.name}`} className="resources-history-list">
        {history.data.map((entry, index) => <li key={index}>
          {new Date(entry.at).toLocaleString()} · {entry.actorName} · {historyText(entry, props.kinds)}
        </li>)}
      </ol> : null}
    </details>
  );
}

const poolBadge: Record<string, "info" | "warning" | "success" | "unknown"> = { available: "success", assigned: "info", out_of_service: "warning", demobilized: "unknown" };

function PoolRow(props: {
  client: ApiClient;
  resource: PoolResource;
  kinds: readonly ResourceKind[];
  requests: readonly ResourceRequestSummary[];
  canMutate: boolean;
  busy: boolean;
  onMove: (id: string, move: { to: string; requestId?: string; returnCondition?: string; checks?: string[] }) => void;
  onEdit: (id: string, input: { name: string; kind: string; type: number | null }) => Promise<boolean>;
}) {
  const r = props.resource;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(r.name);
  const [kind, setKind] = useState(r.kind);
  const [type, setType] = useState(r.type === null ? "" : String(r.type));
  // Kind and type change only while no request holds the resource.
  const retypable = r.status === "available" || r.status === "out_of_service";
  const startEdit = () => { setName(r.name); setKind(r.kind); setType(r.type === null ? "" : String(r.type)); setEditing(true); };
  const save = async () => {
    const saved = await props.onEdit(r.id, { name: name.trim(), kind: retypable ? kind : r.kind,
      type: retypable ? (type ? Number(type) : null) : r.type });
    if (saved) setEditing(false);
  };
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
        <StatusBadge status={poolBadge[r.status] ?? "unknown"}>{choiceLabel(r.status)}</StatusBadge>
        <strong>{r.name}</strong>
        <span className="eoc-muted">{kindText(props.kinds, r.kind, r.type)}</span>
        <span className="eoc-muted">Label code {labelCode(r.id)}</span>
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
      {props.canMutate && r.status !== "demobilized" ? editing ? <div className="resources-form" role="group" aria-label={`Edit ${r.name}`}>
        <div className="resources-cell"><TextField label="Resource name" value={name} onChange={setName} /></div>
        {retypable ? <KindTypeFields kinds={props.kinds} kind={kind} type={type} onKind={setKind} onType={setType} forRequest={false} />
          : <span className="eoc-flush eoc-muted">Its kind and type change once it is no longer assigned.</span>}
        <Button kind="primary" onClick={() => void save()} disabled={props.busy || !name.trim() || !kind}>Save changes</Button>
        <Button onClick={() => setEditing(false)} disabled={props.busy}>Cancel</Button>
      </div> : <div><Button onClick={startEdit} disabled={props.busy}>Edit {r.name}</Button></div> : null}
      <PoolHistory client={props.client} resourceId={r.id} name={r.name} kinds={props.kinds} revision={`${r.status}:${r.name}:${r.kind}:${r.type}`} />
    </li>
  );
}

/** The code printed on a pool resource's label, to type where there is no scanner: the first eight characters of its id. */
const labelCode = (id: string): string => id.slice(0, 8).toUpperCase();

/** The address a pool resource's label links to: this console's resource pool, found to that resource. */
const labelLink = (id: string): string => `${location.origin}${location.pathname}#/resources/pool/${id}`;

/** The resource id a scanned label link or a whole id names; null for anything else. */
function labelledId(text: string): string | null {
  const value = text.trim().toLowerCase();
  const id = /#\/resources\/pool\/([0-9a-f-]{36})$/.exec(value)?.[1] ?? value;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? id : null;
}

/** Whether a pool resource answers a search: a label link, its id or its label code finds it; other words match its name or kind. */
function poolMatches(resource: PoolResource, kind: string, search: string): boolean {
  const text = search.trim().toLowerCase();
  if (!text) return true;
  const id = labelledId(text);
  if (id) return resource.id === id;
  if (/^[0-9a-f]{8}$/.test(text) && resource.id.startsWith(text)) return true;
  return resource.name.toLowerCase().includes(text) || kind.toLowerCase().includes(text);
}

/** Labels print on a sheet of their own at the body level, outside the console shell's fixed panes. */
function LabelSheet(props: { children: ReactNode }) {
  return createPortal(<div className="resources-tag-sheet">{props.children}</div>, document.body);
}

/** A pool resource's label: its name, kind and type, label code, and a QR code linking to it in the pool. */
function ResourceLabel(props: { resource: PoolResource; kind: string }) {
  const r = props.resource;
  return (
    <article className="resources-tag" aria-label={`Label for ${r.name}`}>
      <QrCode value={labelLink(r.id)} label={`QR code linking to ${r.name} in the resource pool`} className="resources-tag-qr" />
      <div className="resources-tag-text">
        <strong className="resources-tag-name">{r.name}</strong>
        <span>{props.kind}</span>
        <span className="resources-tag-code">Label code {labelCode(r.id)}</span>
      </div>
    </article>
  );
}

/** Where this console is open at the computer's own address, so a phone cannot follow a label's link. */
const onLoopback = () => ["localhost", "127.0.0.1", "[::1]", "::1"].includes(location.hostname);

/**
 * The jurisdiction's pool of typed resources: add one, assign it to a matching
 * request, take it out of service, demobilize it; find one by name or by its
 * scanned label, and print labels.
 */
function ResourcePool(props: {
  client: ApiClient;
  jurisdictionId: string;
  kinds: readonly ResourceKind[];
  requests: readonly ResourceRequestSummary[];
  canMutate: boolean;
  foundResourceId: string | null;
  onFindResource: (resourceId: string | null) => void;
}) {
  const pool = useAsync(() => props.client.listResources(props.jurisdictionId), [props.jurisdictionId]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [type, setType] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [find, setFind] = useState(props.foundResourceId ? labelCode(props.foundResourceId) : "");
  const [search, setSearch] = useState(props.foundResourceId ?? "");
  const [scanProblem, setScanProblem] = useState<string | null>(null);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const stack = useRef<HTMLDivElement>(null);
  // A label link opened from a phone, or a label scanned here, finds its
  // resource and brings the pool into view; going back from it shows every resource.
  useEffect(() => {
    if (props.foundResourceId) {
      setFind(labelCode(props.foundResourceId));
      setSearch(props.foundResourceId);
      stack.current?.scrollIntoView?.({ block: "start" });
    } else if (labelledId(search)) {
      setFind("");
      setSearch("");
    }
  }, [props.foundResourceId]);
  const applySearch = (text: string) => {
    const id = labelledId(text);
    const wasLabel = props.foundResourceId !== null || labelledId(search) !== null;
    setSearch(id ?? text.trim());
    if (id) {
      setFind(labelCode(id));
      if (id !== props.foundResourceId) props.onFindResource(id);
    } else if (wasLabel) props.onFindResource(null);
  };
  const scanLabel = (file: File | undefined) => {
    if (!file) return;
    setScanProblem(null);
    void readCodeFromImage(file, ["qr_code"])
      .then((code) => code ? applySearch(code) : setScanProblem("No label was found in that image. Type the label code instead."))
      .catch(() => setScanProblem("That image could not be read. Type the label code instead."));
  };
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
  const kindOf = (resource: PoolResource) => kindText(props.kinds, resource.kind, resource.type);
  const shown = list.filter((resource) => poolMatches(resource, kindOf(resource), search));
  const byLabel = labelledId(search) !== null;
  // A demobilized resource has left the pool for good, so it gets no label.
  const printable = shown.filter((resource) => resource.status !== "demobilized");
  const count = (n: number) => `${n} ${n === 1 ? "resource" : "resources"}`;
  return (
    <Panel title="Resource pool">
      <div className="resources-stack" ref={stack}>
        {props.canMutate ? <div className="resources-form">
          <div className="resources-cell"><TextField label="Resource name" value={name} onChange={setName} /></div>
          <KindTypeFields kinds={props.kinds} kind={kind} type={type} onKind={setKind} onType={setType} forRequest={false} />
          <Button kind="primary" onClick={() => void add()} disabled={busy}>Add to pool</Button>
        </div> : null}
        {pool.loading && !pool.data ? <Loading label="Loading the resource pool…" /> : null}
        {pool.error && !pool.data ? <ErrorNote message={pool.error} /> : null}
        {pool.data && list.length === 0 ? <p className="eoc-flush eoc-muted">No resources in the pool.</p> : null}
        {list.length ? <form className="resources-filters resources-find" role="search" aria-label="Find a resource"
          onSubmit={(event) => { event.preventDefault(); applySearch(find); }}>
          <label className="resources-label">Find a resource<input type="search" className="resources-select" value={find}
            placeholder="Name, kind or label code" onChange={(event) => setFind(event.target.value)} /></label>
          <Button type="submit">Find</Button>
          {canReadCodes() ? <label className="resources-label resources-camera">Scan a resource label<input type="file" accept="image/*"
            capture="environment" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; scanLabel(file); }} /></label> : null}
        </form> : null}
        {scanProblem ? <p role="alert" className="eoc-flush eoc-text-critical">{scanProblem}</p> : null}
        {list.length && search ? <p className="resources-filter-summary" role="status">
          {byLabel ? shown[0] ? `Found by label: ${shown[0].name}.` : "No resource in this pool has that label."
            : `${shown.length} of ${count(list.length)} matching "${search}".`}{" "}
          <button type="button" className="resources-link" onClick={() => { setFind(""); applySearch(""); }}>Show every resource</button>
        </p> : null}
        {list.length ? <div className="resources-actions">
          <Button onClick={() => setLabelsOpen(true)} disabled={!printable.length || labelsOpen}>Show labels for {count(printable.length)}</Button>
        </div> : null}
        {labelsOpen && printable.length ? <section className="resources-tags" aria-labelledby="resources-tags-title">
          <h3 id="resources-tags-title" className="resources-tags-title">Labels to print</h3>
          <p className="eoc-flush eoc-muted">A label's QR code opens its resource in this pool on a phone signed in on this network.
            At the console, scan it into Find a resource, or type its label code.</p>
          {onLoopback() ? <p className="resources-tags-warning">This console is open at this computer's own address, which a phone
            cannot reach, so a phone cannot open these labels. Open the console at the address phones use, then print. Scanning at the
            console works either way.</p> : null}
          <div className="resources-tag-grid">{printable.map((r) => <ResourceLabel key={r.id} resource={r} kind={kindOf(r)} />)}</div>
          <LabelSheet>{printable.map((r) => <ResourceLabel key={r.id} resource={r} kind={kindOf(r)} />)}</LabelSheet>
          <div className="resources-actions">
            <Button kind="primary" onClick={() => window.print()}>Print labels</Button>
            <Button onClick={() => setLabelsOpen(false)}>Close labels</Button>
          </div>
        </section> : null}
        {list.length && !shown.length && !byLabel ? <p className="eoc-flush eoc-muted">No resource in the pool matches.</p> : null}
        {shown.length ? <ul className="resources-list">
          {shown.map((resource) => <PoolRow key={resource.id} client={props.client} resource={resource} kinds={props.kinds} requests={props.requests}
            canMutate={props.canMutate} busy={busy} onMove={(id, move) => void run(() => props.client.transitionResource(id, move))}
            onEdit={async (id, input) => { let saved = false; await run(async () => { await props.client.updateResource(id, input); saved = true; }); return saved; }} />)}
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
  // Costs are the owning organization's; another organization's requests carry none here.
  const costed = props.requests.filter((request): request is typeof request & { costCents: number } => (request.costCents ?? 0) > 0);
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
  const [editing, setEditing] = useState<ResourceKind | null>(null);
  const [editName, setEditName] = useState("");
  const [editDiscipline, setEditDiscipline] = useState("");
  const [editLevels, setEditLevels] = useState("");
  const startEdit = (kind: ResourceKind) => {
    setEditing(kind);
    setEditName(kind.name);
    setEditDiscipline(kind.discipline);
    setEditLevels(kind.levels.length ? String(kind.levels.length) : "");
  };
  const saveKind = () => run(async () => {
    if (!editing) return "";
    const count = editLevels.trim() === "" ? 0 : Number(editLevels);
    if (!editName.trim()) throw new Error("Enter the name of the kind.");
    if (!Number.isInteger(count) || count < 0 || count > 10) throw new Error("Enter from 1 to 10 type levels, or leave it blank for a single type.");
    // A kept level keeps its capability text.
    const levels = Array.from({ length: count }, (_, index) =>
      editing.levels.find((level) => level.type === index + 1) ?? { type: index + 1, capability: "" });
    await props.client.updateResourceKind(props.jurisdictionId, editing.key, {
      name: editName.trim(), discipline: editDiscipline.trim(), levels: [...levels], notes: editing.notes,
    });
    setEditing(null);
    return `Saved ${editName.trim()}.`;
  });
  const deleteKind = (kind: ResourceKind) => run(async () => {
    await props.client.deleteResourceKind(props.jurisdictionId, kind.key);
    if (editing?.key === kind.key) setEditing(null);
    return `Deleted ${kind.name} from the catalog.`;
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
              <thead><tr><th scope="col">Kind</th><th scope="col">Discipline</th><th scope="col">Types</th><th scope="col">Source</th>{props.canManage ? <th scope="col">Actions</th> : null}</tr></thead>
              <tbody>{props.kinds.map((kind) => <tr key={kind.key}>
                <td>{kind.name}</td>
                <td>{kind.discipline}</td>
                <td>{kind.levels.length === 0 ? "Single type" : kind.levels.map((level) => level.capability ? `Type ${level.type}: ${level.capability}` : `Type ${level.type}`).join("; ")}</td>
                <td title={kind.sourceNote}>{sourceText(kind)}</td>
                {props.canManage ? <td>{kind.source === "local" ? <span className="resources-row-actions">
                  <Button onClick={() => startEdit(kind)} disabled={busy}>Edit {kind.name}</Button>
                  <Button onClick={() => void deleteKind(kind)} disabled={busy}>Delete {kind.name}</Button>
                </span> : null}</td> : null}
              </tr>)}</tbody>
            </table>
          </div>
        </details>
        {props.canManage && editing ? <section aria-label={`Edit ${editing.name}`} className="resources-part">
          <h3 className="eoc-flush">Edit {editing.name}</h3>
          <p className="eoc-flush eoc-muted">A type level that a request or a resource still names cannot be removed.</p>
          <div className="resources-form">
            <div className="resources-cell"><TextField label="Kind name" value={editName} onChange={setEditName} /></div>
            <div className="resources-cell"><TextField label="Discipline" value={editDiscipline} onChange={setEditDiscipline} /></div>
            <div className="resources-cell"><TextField label="Type levels (blank for a single type)" value={editLevels} onChange={setEditLevels} /></div>
            <Button kind="primary" onClick={() => void saveKind()} disabled={busy}>Save kind</Button>
            <Button onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
          </div>
        </section> : null}
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
  /** The organization that owns the incident, which a partner may request from. */
  incidentOwnerId?: string | null;
  /** The signed-in person, to find the requests assigned to them. */
  personId?: string | null;
  selectedRequestId?: string | null;
  onSelectRequest?: (id: string | null) => void;
  /** The pool resource a label link or scan found, kept in the address. */
  foundResourceId?: string | null;
  onFindResource?: (resourceId: string | null) => void;
  canMutate?: boolean;
  closed?: boolean;
}) {
  // Every filter narrows the server's answer and is named above the list, so nothing is hidden unsaid.
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<{ q: string; status: "open" | "ended" | "all"; mine: boolean }>({ q: "", status: "all", mine: false });
  const requests = useAsync(
    () => props.client.listResourceRequests(props.jurisdictionId, props.incidentId, filters),
    [props.jurisdictionId, props.incidentId, filters.q, filters.status, filters.mine],
  );
  const [receipt, setReceipt] = useState<ResourceRequestSummary | null>(null);
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
  // A partner on the incident requests from its own organization or from the incident's owner.
  const partner = Boolean(props.incidentId && props.incidentOwnerId && props.incidentOwnerId !== props.jurisdictionId);
  const [requestFrom, setRequestFrom] = useState<"own" | "owner">("own");
  const fromOwner = partner && requestFrom === "owner";

  // The intake is a draft on this device until the server has received it,
  // so leaving the screen, closing the tab or a lapsed session loses nothing.
  const drafts = useDraftStore();
  const intakeScope = props.personId
    ? { personId: props.personId, incidentId: props.incidentId ?? "none", formId: "resource-request", recordId: null, schema: "1" }
    : null;
  const [intake, setIntake] = useState<WorkState>({ kind: "empty" });
  const touched = useRef(false);
  const kept = useRef(false);
  const edit = <T,>(set: (value: T) => void) => (value: T) => { touched.current = true; set(value); };
  useEffect(() => {
    touched.current = false;
    if (!drafts.store || !intakeScope) return;
    let active = true;
    void drafts.store.load(intakeScope).then((draft) => {
      if (!active || !draft || touched.current) return;
      const values = draft.values as Partial<Record<string, string>>;
      setItem(values.item ?? "");
      setQuantity(values.quantity ?? "1");
      setPriority(values.priority ?? "routine");
      setNotes(values.notes ?? "");
      setNeededBy(values.neededBy ?? "");
      setRequestKind(values.requestKind ?? "");
      setRequestType(values.requestType ?? "");
      setRequestFrom(values.requestFrom === "owner" ? "owner" : "own");
      kept.current = true;
      setIntake({ kind: "draft", savedAt: draft.savedAt, restored: true });
    }, () => undefined);
    return () => { active = false; };
  }, [drafts.store, intakeScope?.personId, intakeScope?.incidentId]);
  useEffect(() => {
    if (!touched.current || !drafts.store || !intakeScope) return;
    void drafts.store.save(intakeScope, { item, quantity, priority, notes, neededBy, requestKind, requestType, requestFrom }).then(
      (saved) => { kept.current = true; if (touched.current) setIntake({ kind: "draft", savedAt: saved.savedAt }); },
      () => { kept.current = false; },
    );
  }, [item, quantity, priority, notes, neededBy, requestKind, requestType, requestFrom]);
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

  const submit = async () => {
    if (!item.trim()) {
      setIntake({ kind: "failed", reason: "Enter a requested item.", keptInForm: !kept.current });
      return;
    }
    setBusy(true);
    setReceipt(null);
    setIntake({ kind: "sending" });
    try {
      const created = await props.client.submitResourceRequest(fromOwner ? props.incidentOwnerId! : props.jurisdictionId, {
        origin: "eoc",
        item: item.trim(),
        quantity: Number(quantity) || 1,
        priority,
        ...(neededBy ? { neededBy: new Date(neededBy).toISOString() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        // Tag the request to the working incident so it lists in that context;
        // with no incident selected it stays a jurisdiction-wide request (79B2).
        ...(props.incidentId ? { incidentId: props.incidentId } : {}),
        // The owner types a request made to it from its own catalog.
        ...(requestKind && !fromOwner ? { resourceKind: requestKind } : {}),
        ...(requestType && !fromOwner ? { resourceType: Number(requestType) } : {}),
      });
      touched.current = false;
      if (drafts.store && intakeScope) await drafts.store.clear(intakeScope).catch(() => undefined);
      kept.current = false;
      setReceipt(created);
      setIntake({ kind: "received", at: created.createdAt, reference: `REQ-${created.number}` });
      setItem("");
      setQuantity("1");
      setNotes("");
      setNeededBy("");
      setRequestKind("");
      setRequestType("");
      requests.reload();
    } catch (cause) {
      setIntake({ kind: "failed", reason: cause instanceof Error ? cause.message : String(cause), keptInForm: !kept.current });
    } finally {
      setBusy(false);
    }
  };

  const list = requests.data ?? [];
  // The pool and the cost rollup count every request in scope, whatever the list is narrowed to.
  const filtered = filterParts(filters).length > 0;
  const everything = useAsync(
    () => filtered ? props.client.listResourceRequests(props.jurisdictionId, props.incidentId) : Promise.resolve(null),
    [filtered, props.jurisdictionId, props.incidentId, requests.data],
  );
  const allRequests = filtered ? everything.data ?? [] : list;
  const canMutate = (props.canMutate ?? true) && !props.closed;
  const ownerName = list.find((request) => request.receivingOrganization.id === props.incidentOwnerId)?.receivingOrganization.name
    ?? "The incident's owner";
  // Every organization's requests on the incident are listed; each is worked by its owner.
  const owns = (request: ResourceRequestSummary) => request.receivingOrganization.id === props.jurisdictionId;
  const assignedToMe = (request: ResourceRequestSummary) => !owns(request) && !props.closed
    && request.assignment?.kind === "incident_participant" && request.assignment.personId === props.personId;
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
            {partner ? <div className="resources-cell"><label className="resources-label">Request from<select className="resources-select" value={requestFrom} onChange={(event) => edit(setRequestFrom)(event.target.value as "own" | "owner")}><option value="own">My organization</option><option value="owner">{ownerName} (incident owner)</option></select></label></div> : null}
            <div className="resources-cell"><TextField label="Requested item" value={item} onChange={edit(setItem)} /></div>
            <div className="resources-cell"><TextField label="Quantity" value={quantity} onChange={edit(setQuantity)} /></div>
            <div className="resources-cell"><EnumSelect label="Priority" values={PRIORITIES} labels={PRIORITY_LABELS} value={priority} onChange={edit(setPriority)} /></div>
            <div className="resources-cell"><label className="resources-label">Needed by<input type="datetime-local" className="resources-select" value={neededBy} onChange={(event) => edit(setNeededBy)(event.target.value)} /></label></div>
            <div className="resources-cell"><TextField label="Request notes" value={notes} onChange={edit(setNotes)} /></div>
            {fromOwner ? null : <KindTypeFields kinds={kinds} kind={requestKind} type={requestType} onKind={edit(setRequestKind)} onType={edit(setRequestType)} forRequest />}
          </div><div className="eoc-space-above"><Button kind="primary" onClick={() => void submit()} disabled={busy}>Submit request</Button></div>
          <WorkStateLine state={intake} onRetry={() => void submit()} />
          {receipt ? (
            <section className="resources-receipt" role="status" aria-label="Request receipt">
              <strong>REQ-{receipt.number} received {when(receipt.createdAt)} by {receipt.receivingOrganization.name}</strong>
              <span>Stage: {requestStage(receipt.state)}. Receipt is not acceptance: {receipt.receivingOrganization.name} accepts or declines it next, and whoever accepts it owns it.</span>
              <div className="resources-actions"><Button onClick={() => selectRequest(receipt.id)} label={`Open REQ-${receipt.number} receipt`}>Open REQ-{receipt.number}</Button><Button onClick={() => setReceipt(null)}>Dismiss</Button></div>
            </section>
          ) : null}</> : <p role="status" className="resources-last eoc-muted">{props.closed ? "This incident is closed. Request history remains available." : "Your access is read-only. Request history remains available."}</p>}
        </Panel>

        <Panel title="Requests and next actions">
          <form className="resources-filters" role="search" aria-label="Find requests"
            onSubmit={(event) => { event.preventDefault(); setFilters((current) => ({ ...current, q: search.trim() })); }}>
            <label className="resources-label">Find a request<input type="search" className="resources-select" value={search}
              placeholder="REQ number or words" onChange={(event) => setSearch(event.target.value)} /></label>
            <Button type="submit">Find</Button>
            <label className="resources-label">Show<select className="resources-select" value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as "open" | "ended" | "all" }))}>
              <option value="all">Open and ended</option><option value="open">Open only</option><option value="ended">Ended only</option>
            </select></label>
            <label className="resources-check"><input type="checkbox" checked={filters.mine}
              onChange={(event) => setFilters((current) => ({ ...current, mine: event.target.checked }))} />Only requests I asked for</label>
          </form>
          {requests.data ? (
            <p className="resources-filter-summary" role="status">
              {filterSummary(list.length, filters)}
              {filterParts(filters).length ? <> <button type="button" className="resources-link"
                onClick={() => { setSearch(""); setFilters({ q: "", status: "all", mine: false }); }}>Clear filters</button></> : null}
            </p>
          ) : null}
          {requests.loading && !requests.data ? <Loading label="Loading requests…" /> : null}
          {requests.error && !requests.data ? <ErrorNote message={requests.error} /> : null}
          {requests.data && list.length === 0 && filterParts(filters).length === 0 ? (
            <p className="eoc-flush eoc-muted">No resource requests {props.incidentId ? "on this incident" : "in this organization"} yet.</p>
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
                  canMutate={canMutate && owns(r)}
                  assignee={assignedToMe(r)}
                  busy={busy}
                  onOpen={selectRequest}
                  onAdvance={(id, toState, note) => run(() => props.client.transitionResourceRequest(id, toState, note))}
                  onAssign={(id, assignment) => run(() => props.client.assignResourceRequest(id, assignment))}
                />
              ))}
            </ul>
          ) : null}
        </Panel>

        {detail.loading && selectedRequest ? <Loading label="Loading request history…" /> : null}
        {detail.error ? <ErrorNote message={detail.error} /> : null}
        {detail.data ? <ResourceRequestDetailPanel detail={detail.data} onClose={() => selectRequest(null)}
          onPrint213rr={() => {
            const request = detail.data!;
            void run(async () => saveBlob(await props.client.downloadIcs213rrPdf(request.id), `ics-213rr-req-${request.number}.pdf`));
          }} /> : null}
        {detail.data ? (
          <RequestCostsAndEscalation
            key={detail.data.id}
            client={props.client}
            request={detail.data}
            canMutate={canMutate && owns(detail.data)}
            onEscalated={detail.reload}
            onCostRecorded={requests.reload}
          />
        ) : null}

        {error ? (
          <p role="alert" className="eoc-text-critical">
            {error}
          </p>
        ) : null}

        <ResourcePool client={props.client} jurisdictionId={props.jurisdictionId} kinds={kinds} requests={allRequests} canMutate={props.canMutate ?? true}
          foundResourceId={props.foundResourceId ?? null} onFindResource={props.onFindResource ?? (() => undefined)} />
        <CostRollup kinds={kinds} requests={allRequests} incidentScoped={props.incidentId !== null} />
        {catalog.error && !catalog.data ? <ErrorNote message={catalog.error} /> : null}
        {catalog.data ? <TypingCatalog client={props.client} jurisdictionId={props.jurisdictionId} kinds={kinds}
          canManage={catalog.data.canManage} onChanged={catalog.reload} /> : null}
      </div>
    </Scroll>
  );
}
