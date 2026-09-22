import { useEffect, useMemo, useState } from "react";
import type { OperationalRelationship, OperationalRelationshipCreate, TaskListResponse, ViewRecord } from "@openeoc/shared";
import type { ApiClient, BoardListItem, IapResult, ResourceRequestSummary } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import "./AssessmentRelationships.css";

type Source = OperationalRelationshipCreate["source"];
type LinkKind = Extract<OperationalRelationshipCreate["target"]["kind"], "task" | "resource_request" | "board_record" | "iap_objective">;
type RelationshipBoard = Pick<BoardListItem, "id" | "title">;

const EMPTY_TASKS: TaskListResponse = {
  tasks: [],
  analytics: {
    total: 0,
    byStatus: { open: 0, in_progress: 0, completed: 0 },
    byCategory: {},
    overdue: 0,
    dueNext24Hours: 0,
    upcoming: 0,
    withoutDue: 0,
  },
  filters: {},
};

function iapObjectives(iap: IapResult): readonly string[] {
  const form = iap.content.forms.find((item) => item.id === "ICS-202");
  const section = form?.sections.find((item) => item.heading === "Objectives");
  return section?.lines?.filter((item): item is string => typeof item === "string") ?? [];
}


function boardRecordLabel(board: RelationshipBoard, record: ViewRecord): string {
  for (const key of ["name", "title", "facilityName", "facility_name", "item", "summary", "subject"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return `${board.title}: ${value.trim()}`;
  }
  return `${board.title}: record ${record.id}`;
}

export function AssessmentRelationships(props: {
  readonly client: ApiClient;
  readonly incidentId: string;
  readonly jurisdictionId?: string | null;
  readonly boards?: readonly RelationshipBoard[];
  readonly source: Source;
  readonly onOpenTask?: (id: string) => void;
  readonly onOpenResourceRequest?: (id: string) => void;
  readonly onOpenIap?: (id: string) => void;
  readonly onOpenBoardRecord?: (boardId: string, recordId: string) => void;
  readonly onOpenMapFeature?: (datasetId: string, featureId: string) => void;
  readonly onOpenEsf?: (id: string) => void;
}) {
  const [kind, setKind] = useState<LinkKind>("task");
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const relationships = useAsync(() => typeof props.client.listOperationalRelationships === "function" ? props.client.listOperationalRelationships(props.incidentId) : Promise.resolve([]), [props.client, props.incidentId]);
  const tasks = useAsync(() => typeof props.client.listIncidentTasks === "function" ? props.client.listIncidentTasks(props.incidentId) : Promise.resolve(EMPTY_TASKS), [props.client, props.incidentId]);
  const resources = useAsync(() => props.jurisdictionId && typeof props.client.listResourceRequests === "function" ? props.client.listResourceRequests(props.jurisdictionId, props.incidentId) : Promise.resolve([] as ResourceRequestSummary[]), [props.client, props.incidentId, props.jurisdictionId]);
  const boardRecords = useAsync(async () => {
    if (!props.boards?.length) return [];
    if (typeof props.client.getBoard !== "function" || typeof props.client.boardView !== "function") {
      throw new Error("Board records are unavailable.");
    }
    const records = await Promise.all(props.boards.map(async (board) => {
      const definition = await props.client.getBoard(board.id, props.incidentId);
      const view = definition.views[0];
      if (!view) return [];
      const response = await props.client.boardView(board.id, view.key, props.incidentId);
      return response.records.map((record) => ({
        value: record.id,
        label: boardRecordLabel(board, record),
      }));
    }));
    return records.flat();
  }, [props.client, props.incidentId, props.boards]);
  const esfOverview = useAsync(() => props.source.domain === "lifeline" && typeof props.client.listIncidentEsfAssessments === "function" ? props.client.listIncidentEsfAssessments(props.incidentId) : Promise.resolve(null), [props.client, props.incidentId, props.source.domain]);
  const [objectives, setObjectives] = useState<readonly { readonly value: string; readonly label: string }[]>([]);
  const [objectivesError, setObjectivesError] = useState(false);

  useEffect(() => {
    let live = true;
    setObjectivesError(false);
    if (typeof props.client.listIaps !== "function" || typeof props.client.getIap !== "function") {
      setObjectives([]);
      setObjectivesError(true);
      return () => { live = false; };
    }
    void props.client.listIaps(props.incidentId).then(async (iaps) => {
      const snapshots = await Promise.all(iaps.map((iap) => props.client.getIap(iap.id)));
      if (!live) return;
      setObjectives(snapshots.flatMap((iap: IapResult) => iapObjectives(iap).map((objective, objectiveIndex) => ({
        value: `${iap.id}:${iap.contentRevision}:${objectiveIndex}`,
        label: `${iap.operationalPeriod} · objective ${objectiveIndex + 1}: ${objective}`,
      }))));
    }).catch(() => {
      if (!live) return;
      setObjectives([]);
      setObjectivesError(true);
    });
    return () => { live = false; };
  }, [props.client, props.incidentId]);

  const links = useMemo(() => (relationships.data ?? []).filter((link) =>
    link.source.domain === props.source.domain && link.source.framework === props.source.framework && link.source.definitionKey === props.source.definitionKey,
  ), [relationships.data, props.source]);
  const relatedEsfs = useMemo(() => (esfOverview.data?.states ?? []).filter((state) => {
    const selectedId = state.decision?.selectedAssessmentId;
    const report = selectedId ? state.reports.find((item) => item.id === selectedId) : state.conflict ? undefined : state.reports[0];
    const values = report?.payload.relatedLifelines;
    return Array.isArray(values) && values.includes(props.source.definitionKey);
  }), [esfOverview.data, props.source.definitionKey]);
  const options = kind === "task" ? (tasks.data?.tasks ?? []).map((task) => ({ value: task.id, label: `${task.item} · ${task.status}` }))
    : kind === "resource_request" ? (resources.data ?? []).map((resource) => ({ value: resource.id, label: `${resource.item} · ${resource.state}` }))
      : kind === "board_record" ? (boardRecords.data ?? [])
      : objectives;
  const taskLabels = new Map((tasks.data?.tasks ?? []).map((task) => [task.id, task.item]));
  const resourceLabels = new Map((resources.data ?? []).map((resource) => [resource.id, resource.item]));
  const optionsUnavailable = kind === "task" ? Boolean(tasks.error)
    : kind === "resource_request" ? Boolean(resources.error) || !props.jurisdictionId
      : kind === "board_record" ? Boolean(boardRecords.error)
      : objectivesError;

  const linkedTarget = (link: OperationalRelationship): { readonly label: string; readonly fallbackId?: string } => {
    const { target } = link;
    if (target.kind === "task") {
      const label = taskLabels.get(target.taskId);
      return label ? { label: `Task: ${label}` } : { label: "Task unavailable", fallbackId: target.taskId };
    }
    if (target.kind === "resource_request") {
      const label = resourceLabels.get(target.resourceRequestId);
      return label ? { label: `Resource request: ${label}` } : { label: "Resource request unavailable", fallbackId: target.resourceRequestId };
    }
    if (target.kind === "board_record") {
      return { label: `${target.boardTitle}: ${target.label}` };
    }
    if (target.kind === "map_feature") return { label: `Map feature ${target.featureId}` };
    return { label: `${target.operationalPeriod} · objective ${target.objectiveIndex + 1}: ${target.objectiveLabel}` };
  };

  const openTarget = (link: OperationalRelationship) => {
    const target = link.target;
    if (target.kind === "task" && props.onOpenTask) {
      const id = target.taskId;
      return <button type="button" onClick={() => props.onOpenTask!(id)}>Open task</button>;
    }
    if (target.kind === "resource_request" && props.onOpenResourceRequest) {
      const id = target.resourceRequestId;
      return <button type="button" onClick={() => props.onOpenResourceRequest!(id)}>Open resource request</button>;
    }
    if (target.kind === "iap_objective" && props.onOpenIap) {
      const id = target.iapId;
      return <button type="button" onClick={() => props.onOpenIap!(id)}>Open IAP</button>;
    }
    if (target.kind === "board_record" && props.onOpenBoardRecord) {
      const { boardId, boardRecordId } = target;
      return <button type="button" onClick={() => props.onOpenBoardRecord!(boardId, boardRecordId)}>Open source record</button>;
    }
    if (target.kind === "map_feature" && props.onOpenMapFeature) {
      const { datasetId, featureId } = target;
      return <button type="button" onClick={() => props.onOpenMapFeature!(datasetId, featureId)}>Open on map</button>;
    }
    return null;
  };

  const add = () => {
    if (!targetId || typeof props.client.createOperationalRelationship !== "function") return;
    const target = kind === "task" ? { kind, taskId: targetId } as const
      : kind === "resource_request" ? { kind, resourceRequestId: targetId } as const
        : kind === "board_record" ? { kind, boardRecordId: targetId } as const
        : (() => { const [iapId, revision, index] = targetId.split(":"); return { kind: "iap_objective" as const, iapId: iapId!, contentRevision: Number(revision), objectiveIndex: Number(index) }; })();
    setSaving(true); setError(null);
    void props.client.createOperationalRelationship(props.incidentId, { source: props.source, target }).then(() => {
      setTargetId(""); relationships.reload();
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setSaving(false));
  };

  return <section className="eoc-assessment-relationships" aria-label="Operational relationships">
    <h3>Operational relationships</h3>
    <p>Recorded links only. They do not assign command authority or change the assessed condition.</p>
    {props.source.domain === "lifeline" && relatedEsfs.length ? <div><strong>Related ESFs</strong><ul>{relatedEsfs.map((esf) => <li key={`${esf.framework}:${esf.esf}`}><button type="button" onClick={() => props.onOpenEsf?.(esf.esf)} disabled={!props.onOpenEsf}>{esf.framework} {esf.esf.replaceAll("_", " ")}</button></li>)}</ul></div> : null}
    {relationships.error ? <p role="status">Relationship links are unavailable.</p> : <ul>{links.length ? links.map((link) => {
      const target = linkedTarget(link);
      return <li key={link.id} data-target-kind={link.target.kind} data-target-state={link.targetState}>
        <span>{target.label}</span>{target.fallbackId ? <code>{target.fallbackId}</code> : null}
        {link.targetState === "stale" ? <strong>Stale IAP revision</strong> : null}
        {link.target.kind === "iap_objective" ? <small>Recorded content revision {link.target.contentRevision}</small> : null}
        {openTarget(link)}
        <small>Linked by {link.attribution.personName} · {link.attribution.organizationName}</small>
      </li>;
    }) : <li>No additional recorded links.</li>}</ul>}
    <div className="eoc-assessment-relationship-add">
      <label>Link type<select value={kind} onChange={(event) => { setKind(event.target.value as LinkKind); setTargetId(""); }}><option value="task">Task</option><option value="resource_request">Resource request</option><option value="board_record">Board or facility record</option><option value="iap_objective">Planning objective</option></select></label>
      <label>{kind === "iap_objective" ? "IAP objective snapshot" : kind === "task" ? "Incident task" : kind === "resource_request" ? "Incident resource request" : "Incident board or facility record"}<select value={targetId} disabled={optionsUnavailable} onChange={(event) => setTargetId(event.target.value)}><option value="">Choose a recorded target</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <button type="button" disabled={!targetId || saving || optionsUnavailable} onClick={add}>{saving ? "Linking…" : "Add recorded link"}</button>
    </div>
    {kind === "task" && tasks.error ? <p role="status">Incident tasks are unavailable.</p> : null}
    {kind === "resource_request" && (resources.error || !props.jurisdictionId) ? <p role="status">Incident resource requests are unavailable.</p> : null}
    {kind === "board_record" && boardRecords.error ? <p role="status">Incident board and facility records are unavailable.</p> : null}
    {kind === "iap_objective" && objectivesError ? <p role="status">Planning objectives are unavailable.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
