import { useEffect, useState, type CSSProperties } from "react";
import { RESOURCE_REQUEST_TRANSITIONS, type ResourceRequestAssignment } from "@openeoc/shared";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../../design/components.js";
import { Icon } from "../../design/icons/Icon.js";
import { ResourceRequestDetailPanel } from "../../resources/ResourceRequestDetail.js";
import type { ApiClient, ResourceRequestSummary } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { ErrorNote, Loading, Scroll, SurfaceHeader } from "../screens/parts.js";

const PRIORITIES = ["routine", "priority", "immediate"];

const selectStyle: CSSProperties = {
  fontFamily: "inherit",
  fontSize: "1em",
  padding: 6,
  minHeight: 44,
  borderRadius: 4,
  border: "1px solid var(--eoc-border)",
  background: "var(--eoc-surface)",
  color: "var(--eoc-text)",
  width: "100%",
  minWidth: 0,
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 10px",
  border: "1px solid var(--eoc-border)",
  borderRadius: 4,
};

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
    <li style={{ ...rowStyle, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", alignItems: "start", padding: 14, minWidth: 0 }}>
      <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}><StatusBadge status={stateStatus(props.req.state)}>{props.req.state}</StatusBadge><strong>{props.req.item}</strong><span style={{ color: "var(--eoc-text-muted)" }}>×{props.req.quantity}</span><span style={{ color: "var(--eoc-text-muted)" }}>{props.req.priority} priority</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap: 8, color: "var(--eoc-text-muted)", fontSize: "0.92em" }}><span>Receiving: {props.req.receivingOrganization.name}</span><span>Supplying: {props.req.supplyingOrganization?.name ?? "Not identified"}</span><span>Owner: {assignmentLabel(props.req)}</span></div>
        {props.canMutate && needsAssignment ? <div style={{ display: "grid", gap: 8 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap: 8, alignItems: "end", minWidth: 0 }}><label style={{ display: "grid", gap: 4, minWidth: 0 }}>Assign to named authority<select aria-label={`Assignment for ${props.req.item}`} value={target} onChange={(event) => setTarget(event.target.value)} style={selectStyle}><option value="">Choose a position or incident participant</option>{props.positions.length ? <optgroup label="Positions">{props.positions.map((position) => <option key={position.id} value={`position:${position.id}`}>{position.title}</option>)}</optgroup> : null}{props.participants.length ? <optgroup label="Incident participants">{props.participants.map((participant) => <option key={participant.id} value={`participant:${participant.id}`}>{participant.personName} · {participant.incidentPositionTitle} · {participant.organizationName}</option>)}</optgroup> : null}</select></label><Button kind="primary" onClick={assign} disabled={props.busy || !target}>Assign and advance</Button></div>{props.positions.length === 0 && props.participants.length === 0 ? <span role="status" style={{ color: "var(--eoc-text-muted)" }}>No eligible position or active incident participant is available for assignment.</span> : null}</div> : null}
        {props.canMutate && transitions.length ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap: 8, alignItems: "end", minWidth: 0 }}><label style={{ display: "grid", gap: 4, minWidth: 0 }}>Next action<select aria-label={`Next state for ${props.req.item}`} value={to} onChange={(event) => setTo(event.target.value)} style={selectStyle}>{transitions.map((state) => <option key={state} value={state}>{state}</option>)}</select></label><div style={{ minWidth: 0 }}><TextField label="Transition note" value={note} onChange={setNote} /></div><Button onClick={() => props.onAdvance(props.req.id, to, note)} disabled={props.busy || !to}>Advance</Button></div> : !needsAssignment ? <span style={{ color: "var(--eoc-text-muted)" }}>{props.canMutate ? "Lifecycle complete" : "Read-only request"}</span> : !props.canMutate ? <span style={{ color: "var(--eoc-text-muted)" }}>Read-only request</span> : null}
      </div>
      <Button onClick={() => props.onHistory(props.req.id)} disabled={props.busy}>History</Button>
    </li>
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
  const [item, setItem] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [priority, setPriority] = useState("routine");
  const [notes, setNotes] = useState("");
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
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        // Tag the request to the working incident so it lists in that context;
        // with no incident selected it stays a jurisdiction-wide request (79B2).
        ...(props.incidentId ? { incidentId: props.incidentId } : {}),
      });
      setItem("");
      setQuantity("1");
      setNotes("");
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
      <div style={{ display: "grid", gap: 16, width: "min(100%, 1200px)", maxWidth: 1200, minWidth: 0, containerType: "inline-size" }}>
        <Panel title="Request intake">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, color: "var(--eoc-brand-teal)" }}><Icon name="resources" decorative size={20} /><strong>ICS 213RR coordination</strong></div>
          <p style={{ marginTop: 0, color: "var(--eoc-text-muted)" }}>The receiving organization owns the request. A supplier is named only when an authorized position or incident participant accepts the assignment.</p>
          {props.incidentId ? <p style={{ marginTop: 0, color: "var(--eoc-text-muted)" }}>This intake is linked to the selected incident; the request history retains every lifecycle action.</p> : null}
          {canMutate ? <><div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 210px), 1fr))", minWidth: 0 }}>
            <div style={{ minWidth: 0 }}><TextField label="Requested item" value={item} onChange={setItem} /></div>
            <div style={{ minWidth: 0 }}><TextField label="Quantity" value={quantity} onChange={setQuantity} /></div>
            <div style={{ minWidth: 0 }}><EnumSelect label="Priority" values={PRIORITIES} value={priority} onChange={setPriority} /></div>
            <div style={{ minWidth: 0 }}><TextField label="Request notes" value={notes} onChange={setNotes} /></div>
          </div><div style={{ marginTop: 12 }}><Button kind="primary" onClick={submit} disabled={busy}>Submit request</Button></div></> : <p role="status" style={{ marginBottom: 0, color: "var(--eoc-text-muted)" }}>{props.closed ? "This incident is closed. Request history remains available." : "Your access is read-only. Request history remains available."}</p>}
        </Panel>

        <Panel title="Requests and next actions">
          {requests.loading && !requests.data ? <Loading label="Loading requests…" /> : null}
          {requests.error && !requests.data ? <ErrorNote message={requests.error} /> : null}
          {requests.data && list.length === 0 ? (
            <p style={{ color: "var(--eoc-text-muted)", margin: 0 }}>No resource requests in this scope.</p>
          ) : null}
          {list.length > 0 ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
              {list.map((r) => (
                <RequestRow
                  key={r.id}
                  req={r}
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

        {error ? (
          <p role="alert" style={{ color: "var(--eoc-status-critical)" }}>
            {error}
          </p>
        ) : null}
      </div>
    </Scroll>
  );
}
