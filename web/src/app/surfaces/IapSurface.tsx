import { useEffect, useMemo, useRef, useState } from "react";
import { componentFormLabel } from "@openeoc/shared";
import type {
  IapDisplayState,
  IapWorkspaceItem,
  IapWorkspaceQuery,
  IapWorkspaceResponse,
  IncidentAreaRevision,
} from "@openeoc/shared";
import { Button, Panel, StatusBadge, type Status } from "../../design/components.js";
import type {
  ApiClient,
  IapResult,
  IapRevisionSummary,
  Ics204AssignmentInput,
  PositionRef,
} from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { EmptyState, Loading, Scroll, SurfaceHeader } from "../screens/parts.js";
import { FormPreview } from "../../iap/FormPreview.js";
import { Ics204Editor } from "../../iap/Ics204Editor.js";
import "../../iap/iap-workspace.css";

const STATUS_ORDER: readonly IapDisplayState[] = [
  "not_started", "in_progress", "in_approval", "approved", "complete",
];

const STATUS_LABEL: Readonly<Record<IapDisplayState, string>> = {
  not_started: "Not started",
  in_progress: "In progress",
  in_approval: "In approval",
  approved: "Approved",
  complete: "Complete",
};

const STATUS_TONE: Readonly<Record<IapDisplayState, Status>> = {
  not_started: "unknown",
  in_progress: "info",
  in_approval: "warning",
  approved: "success",
  complete: "success",
};

interface PeriodChoice {
  readonly revision: number;
  readonly label: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

function periodChoices(revisions: readonly IncidentAreaRevision[]): PeriodChoice[] {
  const seen = new Set<number>();
  return [...revisions]
    .sort((a, b) => b.revision - a.revision)
    .flatMap((revision) => {
      if (!revision.operationalPeriod || seen.has(revision.revision)) return [];
      seen.add(revision.revision);
      return [{ revision: revision.revision, ...revision.operationalPeriod }];
    });
}

function emptyWorkspace(query: IapWorkspaceQuery): IapWorkspaceResponse {
  return {
    iaps: [],
    query,
    summary: {
      total: 0,
      byState: { not_started: 0, in_progress: 0, in_approval: 0, approved: 0, complete: 0 },
      completedForms: 0,
      requiredForms: 0,
    },
    facets: { organizations: [], roles: [] },
  };
}

/** A stored form's tab key: a plan assembled from forms can hold several 204s. */
function formKey(form: { readonly id: string }, index: number): string {
  return `${index}:${form.id}`;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function Progress(props: { readonly item: IapWorkspaceItem }) {
  const { progress } = props.item;
  return (
    <div className="iap-progress">
      <div
        className="iap-progress-track"
        role="progressbar"
        aria-label={`${props.item.operationalPeriod} form progress`}
        aria-valuemin={0}
        aria-valuemax={progress.required}
        aria-valuenow={progress.completed}
        aria-valuetext={`${progress.completed} of ${progress.required} required forms`}
      >
        <span style={{ width: `${progress.percent}%` }} />
      </div>
      <small>{progress.completed} of {progress.required} required forms · {progress.percent}%</small>
    </div>
  );
}

function WorkspaceRow(props: {
  readonly item: IapWorkspaceItem;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const item = props.item;
  return (
    <li>
      <button
        type="button"
        className="iap-list-button"
        aria-current={props.selected ? "true" : undefined}
        onClick={props.onSelect}
      >
        <span className="iap-list-heading">
          <strong>{item.period?.label ?? item.operationalPeriod}</strong>
          <StatusBadge status={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</StatusBadge>
        </span>
        <span className="iap-row-meta">
          <span>Revision {item.revisionNumber}</span>
          <span>{item.preparedAttribution.organizationName}</span>
          <span>{item.preparedAttribution.roleLabel}</span>
          <span>Prepared by {item.preparedBy ?? "unknown"}</span>
        </span>
        <Progress item={item} />
      </button>
    </li>
  );
}

export interface IapSurfaceProps {
  readonly client: ApiClient;
  readonly jurisdictionId: string;
  readonly incidentId: string | null;
  readonly incidentName?: string | null;
  readonly periodRevision?: number | null;
  readonly operationalPeriod?: string | null;
  readonly isAdmin: boolean;
  readonly initialIapId?: string | null;
  readonly onSelectIap?: (id: string | null) => void;
  readonly onOpenForms?: () => void;
}

export function IapSurface(props: IapSurfaceProps) {
  const [query, setQuery] = useState<IapWorkspaceQuery>({ view: "all" });
  const [selectedId, setSelectedId] = useState<string | null>(props.initialIapId ?? null);
  const [selectedForm, setSelectedForm] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignmentsDirty, setAssignmentsDirty] = useState(false);
  const [pendingChange, setPendingChange] = useState<
    | { readonly kind: "query"; readonly query: IapWorkspaceQuery }
    | { readonly kind: "select"; readonly id: string | null }
    | { readonly kind: "forms" }
    | null
  >(null);
  const active = props.incidentId;
  const scopeRef = useRef(active);
  const dirtyRef = useRef(assignmentsDirty);
  const selectedIdRef = useRef(selectedId);
  const initialIapIdRef = useRef(props.initialIapId);
  dirtyRef.current = assignmentsDirty;
  selectedIdRef.current = selectedId;
  initialIapIdRef.current = props.initialIapId;

  useEffect(() => {
    const nextQuery: IapWorkspaceQuery = initialIapIdRef.current
      ? { view: "all" }
      : { view: "all", ...(props.periodRevision ? { periodRevision: props.periodRevision } : {}) };
    if (scopeRef.current !== active) {
      scopeRef.current = active;
      setQuery(nextQuery);
      setSelectedId(initialIapIdRef.current ?? null);
      setSelectedForm(null);
      setAssignmentsDirty(false);
      setPendingChange(null);
      return;
    }
    if (dirtyRef.current) setPendingChange({ kind: "query", query: nextQuery });
    else {
      setQuery(nextQuery);
      setSelectedId(initialIapIdRef.current ?? null);
      setSelectedForm(null);
      setAssignmentsDirty(false);
    }
  }, [active, props.periodRevision]);

  useEffect(() => {
    if (props.initialIapId === undefined || props.initialIapId === selectedIdRef.current) return;
    if (dirtyRef.current) setPendingChange({ kind: "select", id: props.initialIapId });
    else {
      setSelectedId(props.initialIapId);
      setSelectedForm(null);
    }
  }, [props.initialIapId]);

  useEffect(() => {
    if (!assignmentsDirty) setPendingChange(null);
  }, [assignmentsDirty]);

  const workspace = useAsync(
    () => active ? props.client.queryIapWorkspace(active, query) : Promise.resolve(emptyWorkspace(query)),
    [active, query.view, query.organizationId, query.periodRevision, query.role, reload],
  );
  const periods = useAsync(async () => {
    if (!active) return [] as PeriodChoice[];
    const [current, history] = await Promise.all([
      props.client.getIncidentArea(active),
      props.client.incidentAreaHistory(active),
    ]);
    return periodChoices([current, ...history]);
  }, [active]);
  const positions = useAsync(
    () => active ? props.client.listPositions(props.jurisdictionId) : Promise.resolve([] as PositionRef[]),
    [active, props.jurisdictionId],
  );
  const participants = useAsync(
    () => active ? props.client.listIncidentParticipants(active) : Promise.resolve([]),
    [active],
  );
  const detail = useAsync(async () => {
    if (!selectedId) return null as { iap: IapResult; revisions: IapRevisionSummary[] } | null;
    const [iap, revisions] = await Promise.all([
      props.client.getIap(selectedId),
      props.client.listIapRevisions(selectedId),
    ]);
    return { iap, revisions };
  }, [selectedId, reload]);

  const items = workspace.data?.iaps ?? [];
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  useEffect(() => {
    const forms = detail.data?.iap.content.forms;
    if (!forms?.length) {
      setSelectedForm(null);
      return;
    }
    if (!selectedForm || !forms.some((form, index) => formKey(form, index) === selectedForm)) setSelectedForm(formKey(forms[0]!, 0));
  }, [detail.data, selectedForm]);

  if (!active) {
    return (
      <EmptyState
        label="No incident selected."
        hint="Choose an incident before reviewing or revising its Incident Action Plans."
      />
    );
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setReload((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  function applyQuery(next: IapWorkspaceQuery) {
    setQuery(next);
    setSelectedId(null);
    props.onSelectIap?.(null);
    setSelectedForm(null);
    setAssignmentsDirty(false);
  }

  function requestQuery(next: IapWorkspaceQuery) {
    if (assignmentsDirty) setPendingChange({ kind: "query", query: next });
    else applyQuery(next);
  }

  function applySelection(id: string | null) {
    setSelectedId(id);
    setSelectedForm(null);
    props.onSelectIap?.(id);
  }

  function requestSelection(id: string) {
    if (id === selectedId) return;
    if (assignmentsDirty) setPendingChange({ kind: "select", id });
    else applySelection(id);
  }

  function requestForms() {
    if (!props.onOpenForms) return;
    if (assignmentsDirty) setPendingChange({ kind: "forms" });
    else props.onOpenForms();
  }

  function keepEditing() {
    setPendingChange(null);
    props.onSelectIap?.(selectedId);
  }

  function discardAndContinue() {
    const pending = pendingChange;
    setPendingChange(null);
    setAssignmentsDirty(false);
    if (!pending) return;
    if (pending.kind === "query") applyQuery(pending.query);
    else if (pending.kind === "select") applySelection(pending.id);
    else props.onOpenForms?.();
  }

  async function exactPdf(iapId: string, revision: number, period: string) {
    setBusy(true);
    setError(null);
    try {
      const blob = await props.client.downloadIapRevisionPdf(iapId, revision);
      const safePeriod = period.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "period";
      downloadBlob(blob, `iap-${safePeriod}-revision-${revision}.pdf`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const selectedFormContent = detail.data?.iap.content.forms.find((form, index) => formKey(form, index) === selectedForm) ?? null;
  const planForms = detail.data?.iap.components ?? [];
  const waitingForms = planForms.filter((part) => part.currentVersion > part.version && part.currentStatus === "ready").length;
  const hasSuccessor = (detail.data?.revisions ?? []).some((revision) => revision.supersedesIapId === selectedId);
  const summary = workspace.data?.summary ?? emptyWorkspace(query).summary;
  const contextPeriod = query.periodRevision === undefined
    ? null
    : periods.data?.find((period) => period.revision === query.periodRevision) ?? null;
  const periodLabel = query.periodRevision === undefined
    ? "All operational periods"
    : contextPeriod?.label
      ?? (props.periodRevision === query.periodRevision ? props.operationalPeriod : null)
      ?? `Operational period revision ${query.periodRevision}`;

  return (
    <Scroll>
      <SurfaceHeader
        title="Incident Action Plans"
        actions={props.onOpenForms ? <Button onClick={requestForms}>Open ICS forms</Button> : undefined}
      />
      <div className="iap-workspace">
        <div className="iap-context" aria-label="IAP workspace context">
          <strong>{props.incidentName ?? "Selected incident"}</strong>
          <span>Incident {active}</span>
          <span>{periodLabel}</span>
          {query.periodRevision ? <span>Area revision {query.periodRevision}</span> : null}
        </div>

        {pendingChange && assignmentsDirty ? (
          <section role="alertdialog" aria-label="Unsaved ICS-204 changes" className="iap-callout">
            <strong>Unsaved ICS-204 changes</strong>
            <p>Keep editing, or discard this draft before changing plans, filters, or planning surfaces.</p>
            <div className="iap-actions">
              <Button onClick={keepEditing}>Keep editing</Button>
              <Button kind="danger" onClick={discardAndContinue}>Discard changes and continue</Button>
            </div>
          </section>
        ) : null}

        <Panel title="Working and published plans">
          <div className="iap-filter-grid">
            <label className="iap-field">
              <span>Plan view</span>
              <select value={query.view} onChange={(event) => requestQuery({
                ...query, view: event.target.value as IapWorkspaceQuery["view"],
              })}>
                <option value="all">All plans</option>
                <option value="working">Working</option>
                <option value="published">Published</option>
              </select>
            </label>
            <label className="iap-field">
              <span>Operational period</span>
              <select value={query.periodRevision ?? ""} onChange={(event) => {
                const value = event.target.value;
                const { periodRevision: _periodRevision, ...rest } = query;
                requestQuery(value ? { ...rest, periodRevision: Number(value) } : rest);
              }}>
                <option value="">All periods</option>
                {(periods.data ?? []).map((period) => (
                  <option key={period.revision} value={period.revision}>
                    {period.label} · revision {period.revision}
                  </option>
                ))}
              </select>
            </label>
            <label className="iap-field">
              <span>Organization</span>
              <select value={query.organizationId ?? ""} onChange={(event) => {
                const value = event.target.value;
                const { organizationId: _organizationId, ...rest } = query;
                requestQuery(value ? { ...rest, organizationId: value } : rest);
              }}>
                <option value="">All organizations</option>
                {(workspace.data?.facets.organizations ?? []).map((facet) => (
                  <option key={facet.key} value={facet.key}>{facet.label} ({facet.count})</option>
                ))}
              </select>
            </label>
            <label className="iap-field">
              <span>Prepared role</span>
              <select value={query.role ?? ""} onChange={(event) => {
                const value = event.target.value;
                const { role: _role, ...rest } = query;
                requestQuery(value ? { ...rest, role: value } : rest);
              }}>
                <option value="">All roles</option>
                {(workspace.data?.facets.roles ?? []).map((facet) => (
                  <option key={facet.key} value={facet.key}>{facet.label} ({facet.count})</option>
                ))}
              </select>
            </label>
          </div>
        </Panel>

        {workspace.data ? (
          <section className="iap-summary" aria-label="Plan status totals">
            <article><strong>{summary.total}</strong><span>Plans in view</span></article>
            {STATUS_ORDER.map((status) => (
              <article key={status}>
                <strong>{summary.byState[status]}</strong>
                <span>{STATUS_LABEL[status]}</span>
              </article>
            ))}
          </section>
        ) : (
          <section aria-label="Plan status totals">
            {workspace.loading ? <Loading label="Loading plan totals…" /> : null}
            {workspace.error ? <p role="alert" className="iap-error">Plan totals unavailable: {workspace.error}</p> : null}
          </section>
        )}

        <div className="iap-split">
          <Panel title="Plans">
            {workspace.loading && !workspace.data ? <Loading label="Loading plans…" /> : null}
            {workspace.error ? <p role="alert" className="iap-error">{workspace.error}</p> : null}
            {!workspace.loading && items.length === 0 ? (
              <p className="iap-muted">No plans match the selected incident and filters.</p>
            ) : null}
            <ul className="iap-list">
              {items.map((item) => (
                <WorkspaceRow
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  onSelect={() => requestSelection(item.id)}
                />
              ))}
            </ul>
          </Panel>

          <Panel title="Plan detail">
            {!selectedId ? <p className="iap-muted">Choose a plan to review its stored forms and revision history.</p> : null}
            {detail.loading && selectedId ? <Loading label="Loading selected plan…" /> : null}
            {detail.error ? <p role="alert" className="iap-error">{detail.error}</p> : null}
            {selectedItem && detail.data ? (
              <div className="iap-detail">
                <div className="iap-detail-heading">
                  <h2>{selectedItem.period?.label ?? selectedItem.operationalPeriod}</h2>
                  <StatusBadge status={STATUS_TONE[selectedItem.status]}>
                    {STATUS_LABEL[selectedItem.status]}
                  </StatusBadge>
                </div>
                <p className="iap-muted">
                  Revision {selectedItem.revisionNumber}, content revision {selectedItem.contentRevision}
                  {" · "}{selectedItem.preparedAttribution.organizationName}
                  {" · "}{selectedItem.preparedAttribution.roleLabel}
                </p>
                <p className="iap-muted">
                  Prepared by {selectedItem.preparedBy ?? "unknown"} at {formatTime(selectedItem.createdAt)}
                  {selectedItem.submittedBy && selectedItem.submittedAt
                    ? ` · Submitted by ${selectedItem.submittedBy} at ${formatTime(selectedItem.submittedAt)}`
                    : " · Not submitted"}
                  {selectedItem.approvedBy && selectedItem.approvedAt
                    ? ` · Approved by ${selectedItem.approvedBy} at ${formatTime(selectedItem.approvedAt)}`
                    : " · Not approved"}
                </p>
                <div className="iap-actions">
                  {selectedItem.status === "not_started" || selectedItem.status === "in_progress" ? (
                    <Button onClick={() => void run(() => props.client.submitIap(selectedItem.id).then(() => undefined))} disabled={busy || assignmentsDirty}>
                      Submit for approval
                    </Button>
                  ) : null}
                  {props.isAdmin && ["not_started", "in_progress", "in_approval"].includes(selectedItem.status) ? (
                    <Button kind="primary" onClick={() => void run(() => props.client.approveIap(selectedItem.id).then(() => undefined))} disabled={busy || assignmentsDirty}>
                      Approve revision
                    </Button>
                  ) : null}
                  {props.isAdmin && selectedItem.status === "approved" ? (
                    <Button onClick={() => void run(() => props.client.completeIap(selectedItem.id).then(() => undefined))} disabled={busy || assignmentsDirty}>
                      Mark complete
                    </Button>
                  ) : null}
                  <Button onClick={() => void exactPdf(selectedItem.id, selectedItem.revisionNumber, selectedItem.operationalPeriod)} disabled={busy}>
                    Download revision {selectedItem.revisionNumber} PDF
                  </Button>
                </div>
                {assignmentsDirty ? (
                  <p className="iap-callout">Save the ICS-204 assignment draft before changing workflow status.</p>
                ) : null}

                {planForms.length > 0 ? (
                  <section aria-label="Forms in this plan">
                    <h3>Forms in this plan</h3>
                    <ul className="iap-lineage">
                      {planForms.map((part) => (
                        <li key={part.componentId} className="iap-lineage-row">
                          <span>
                            <strong>{componentFormLabel(part.formId)}{part.label ? `, ${part.label}` : ""}</strong>
                            {" · "}version {part.version}
                          </span>
                          {part.currentVersion > part.version ? (
                            <StatusBadge status={part.currentStatus === "ready" ? "warning" : "unknown"}>
                              Version {part.currentVersion} {part.currentStatus === "ready" ? "ready" : "in draft"}
                            </StatusBadge>
                          ) : <StatusBadge status="success">Current</StatusBadge>}
                        </li>
                      ))}
                    </ul>
                    {waitingForms > 0 && (selectedItem.status === "not_started" || selectedItem.status === "in_progress"
                      || (selectedItem.status === "approved" && !hasSuccessor)) ? (
                      <div className="iap-actions">
                        <Button kind="primary" disabled={busy} onClick={() => void run(async () => {
                          const change = await props.client.refreshIapForms(selectedItem.id);
                          if (change.id !== selectedItem.id) {
                            setQuery((current) => ({ ...current, view: "working" }));
                            setSelectedId(change.id);
                          }
                        })}>
                          {selectedItem.status === "approved"
                            ? `Start revision ${selectedItem.revisionNumber + 1} with the changed forms`
                            : "Take the changed forms into this draft"}
                        </Button>
                      </div>
                    ) : null}
                    {waitingForms > 0 && selectedItem.status === "in_approval" ? (
                      <p className="iap-callout">A form changed after this plan was submitted. Approve it, then start the next revision with the changed forms.</p>
                    ) : null}
                  </section>
                ) : null}

                <section aria-label="Stored IAP forms">
                  <h3>Stored form snapshot</h3>
                  <div className="iap-form-tabs" role="tablist" aria-label="Stored forms">
                    {detail.data.iap.content.forms.map((form, index) => {
                      const ref = detail.data!.iap.content.components?.[index];
                      return (
                        <button
                          key={formKey(form, index)}
                          type="button"
                          role="tab"
                          aria-selected={formKey(form, index) === selectedForm}
                          onClick={() => setSelectedForm(formKey(form, index))}
                        >
                          {ref?.label ? `${form.id} ${ref.label}` : form.id}
                        </button>
                      );
                    })}
                  </div>
                  {selectedFormContent ? <FormPreview form={selectedFormContent} /> : <p>No forms recorded.</p>}
                </section>

                {planForms.length > 0 ? (
                  <p className="iap-muted">
                    This plan&apos;s 204 assignments are ICS forms of the period; change them under ICS Forms.
                  </p>
                ) : (
                <section aria-label="ICS-204 planning">
                  <h3>ICS-204 assignments</h3>
                  <Ics204Editor
                    revisionKey={`${selectedItem.id}:${selectedItem.contentRevision}:${selectedItem.status}`}
                    contentRevision={selectedItem.contentRevision}
                    incidentId={active}
                    status={selectedItem.status}
                    assignments={detail.data.iap.content.ics204Assignments ?? []}
                    positions={positions.data ?? []}
                    participants={participants.data ?? []}
                    busy={busy}
                    onDirtyChange={setAssignmentsDirty}
                    onSave={(assignments: readonly Ics204AssignmentInput[], expectedContentRevision: number) => run(async () => {
                      await props.client.replaceIcs204Assignments(selectedItem.id, {
                        expectedContentRevision,
                        assignments,
                      });
                    })}
                    onCreateRevision={(assignments: readonly Ics204AssignmentInput[]) => run(async () => {
                      const created = await props.client.createIapRevision(selectedItem.id, { assignments });
                      setQuery((current) => ({ ...current, view: "working" }));
                      setSelectedId(created.id);
                    })}
                  />
                  {positions.error ? <p role="alert" className="iap-error">Position authorities unavailable: {positions.error}</p> : null}
                  {participants.error ? <p role="alert" className="iap-error">Participant authorities unavailable: {participants.error}</p> : null}
                </section>
                )}

                <section aria-label="Revision history">
                  <h3>Revision history</h3>
                  <ul className="iap-lineage">
                    {detail.data.revisions.map((revision) => (
                      <li key={revision.id} className="iap-lineage-row">
                        <span>
                          <strong>Revision {revision.revisionNumber}</strong>
                          {" · "}{revision.status}
                          {" · "}{formatTime(revision.createdAt)}
                          {" · "}Prepared by {revision.preparedBy ?? "unknown"}
                          {revision.approvedBy && revision.approvedAt
                            ? ` · Approved by ${revision.approvedBy} at ${formatTime(revision.approvedAt)}`
                            : " · Not approved"}
                        </span>
                        <Button onClick={() => void exactPdf(selectedItem.id, revision.revisionNumber, selectedItem.operationalPeriod)} disabled={busy}>
                          Download exact revision
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            ) : null}
            {error ? <p role="alert" className="iap-error">{error}</p> : null}
          </Panel>
        </div>
      </div>
    </Scroll>
  );
}
