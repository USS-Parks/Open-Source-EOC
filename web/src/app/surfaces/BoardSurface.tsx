import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { choiceLabel, type BoardTemplate, type FieldDef, type FormLayout, type ViewRecord } from "@openeoc/shared";
import { BoardImport, type ImportRun } from "../../boards/BoardImport.js";
import {
  BoardModeBody,
  BoardModeControls,
  initialModeState,
  modeQuery,
  type BoardModeBodyProps,
  type BoardModeState,
} from "../../boards/BoardModes.js";
import { BoardView } from "../../boards/BoardView.js";
import { RecordForm } from "../../boards/RecordForm.js";
import { RecordHistory, type HistoryPageLoader } from "../../boards/RecordHistory.js";
import { RecordWorkflowPanel, type RecordWorkflowSource } from "../../boards/RecordWorkflow.js";
import { OFFLINE_SYNC_UNAVAILABLE, offlineSyncAvailable } from "../../boards/record-access.js";
import "../../boards/board-parts.css";
import {
  GroupCounts,
  NO_REFINEMENT,
  refinedView,
  refinementQuery,
  ViewRefineControls,
  type ViewRefinement,
} from "../../boards/ViewRefine.js";
import { ActionButton, Tabs } from "../../design/controls.js";
import type { ScopedDraftStore } from "../../design/form-drafts.js";
import { Drawer, ModalDialog } from "../../design/overlays.js";
import { Icon } from "../../design/icons/Icon.js";
import {
  createOperationalTableViewState,
  type OperationalTableViewState,
} from "../../design/table.js";
import { OperationalTableSavedViews, useOperationalTableViews } from "../../design/table-saved-views.js";
import { useDraftStore } from "../../offline/draft-store.js";
import type {
  ApiClient,
  BoardRecordDetailResponse,
  EffectiveBoardResponse,
  FileMetaRef,
  RecordReferenceOption,
  ViewRecordsResponse,
} from "../api/client.js";
import { useSession } from "../auth/session.js";
import { useAsync } from "../data/hooks.js";
import { uploadPickedFile } from "../data/files.js";
import { useSurface } from "../router.js";
import { EmptyState, ErrorNote, Loading, Scroll, SurfaceHeader } from "../screens/parts.js";

/**
 * A single board: its first display view rendered as a table, with a record
 * form for writers. Validation uses the same shared schema the server
 * enforces, so the form can never submit what the server would refuse; a
 * viewer sees the data with no write affordance. Conditions, sort keys,
 * grouping and archived records refine the view on the server; writers can
 * import, and anyone who reads the view can export it.
 */
export type BoardRecordContext =
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly record: ViewRecord;
      readonly detail: BoardRecordDetailResponse;
      readonly fields: readonly FieldDef[];
      readonly layout?: FormLayout;
      readonly related: Readonly<Record<string, RecordReferenceOption>>;
      readonly attachments: Readonly<Record<string, FileMetaRef>>;
      readonly canEdit: boolean;
      readonly onEdit: () => void;
      readonly onDownloadAttachment: (fieldKey: string) => Promise<void>;
      readonly workflow?: RecordWorkflowSource;
      /** Archive and restore for writers the record's edit rule admits; delete for jurisdiction admins. */
      readonly lifecycle?: {
        readonly canArchive: boolean;
        readonly canDelete: boolean;
        readonly onArchive: (archived: boolean) => Promise<void>;
        readonly onDelete: () => Promise<void>;
      };
      readonly history?: HistoryPageLoader;
    }
  | { readonly status: "missing" };

export function BoardSurface(props: {
  client: ApiClient;
  boardId: string;
  incidentId?: string | null;
  incidentScoped?: boolean;
  recordId?: string;
  onDesign?: () => void;
  onRecordContext?: (state: BoardRecordContext | null) => void;
  draftStore?: ScopedDraftStore;
}) {
  const session = useSession();
  const route = useSurface();
  const incidentViewId = props.incidentScoped ? props.incidentId : null;
  const board = useAsync(
    () => props.client.getBoard(props.boardId, incidentViewId),
    [incidentViewId, props.boardId],
  );
  const viewKey = board.data?.views.some((view) => view.key === route.routeContext.view)
    ? route.routeContext.view!
    : (board.data?.views[0]?.key ?? null);
  const [refinement, setRefinement] = useState<ViewRefinement>(NO_REFINEMENT);
  // The view mode, its field and the calendar range are screen state, like the refinement.
  const [mode, setMode] = useState<BoardModeState>(() => initialModeState());
  useEffect(() => {
    setRefinement(NO_REFINEMENT);
    setMode(initialModeState());
  }, [props.boardId]);
  const boardFields = board.data?.fields;
  const query = useMemo(() => modeQuery({
    ...(incidentViewId ? { incidentId: incidentViewId } : {}),
    ...refinementQuery(refinement),
  }, mode, boardFields ?? []), [boardFields, incidentViewId, mode, refinement]);
  const view = useAsync(
    () => (viewKey ? props.client.boardViewPage(props.boardId, viewKey, query) : Promise.resolve(null)),
    [props.boardId, query, viewKey],
  );
  // Pages added with "Load more" extend the first page they were read after,
  // under the same refinement, so a reload, a view change or a new refinement
  // starts again from the first page.
  const [more, setMore] = useState<{ base: ViewRecordsResponse; records: readonly ViewRecord[]; nextCursor: string | null } | null>(null);
  const loaded = view.data && more?.base === view.data ? more
    : view.data ? { base: view.data, records: view.data.records, nextCursor: view.data.nextCursor ?? null } : null;
  const nextCursor = loaded?.nextCursor ?? null;
  const loadMore = loaded && nextCursor && viewKey ? async () => {
    const next = await props.client.boardViewPage(props.boardId, viewKey, query, { cursor: nextCursor });
    setMore({ base: loaded.base, records: [...loaded.records, ...next.records], nextCursor: next.nextCursor });
  } : undefined;
  // A caller whom a record rule restricts is never served the board for offline sync.
  const offline = useAsync(async () => (board.data ? offlineSyncAvailable(props.client, board.data) : true),
    [board.data, props.client]);
  // Kanban needs the board's workflow to keep a workflow state field out of drag and drop.
  const kanban = mode.mode === "kanban";
  const workflow = useAsync(async () => kanban && board.data
    ? (await props.client.getTemplateVersion(board.data.templateKey, board.data.templateVersion)).workflow ?? null
    : null, [kanban, board.data?.templateKey, board.data?.templateVersion]);
  const detail = useAsync(
    () => (props.recordId
      ? props.client.boardRecordDetail(props.boardId, props.recordId, incidentViewId)
      : Promise.resolve(null)),
    [incidentViewId, props.boardId, props.recordId],
  );
  const resources = useAsync(
    () => loadRecordResources(props.client, board.data?.fields ?? [], detail.data, props.boardId, incidentViewId),
    [board.data?.fields, detail.data, incidentViewId, props.boardId],
  );
  const drafts = useDraftStore(props.draftStore);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [addingDirty, setAddingDirty] = useState(false);
  const [editingDirty, setEditingDirty] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setAdding(false);
    setEditing(false);
    setAddingDirty(false);
    setEditingDirty(false);
  }, [props.boardId, props.incidentId, props.recordId]);
  useEffect(() => {
    setImporting(false);
    setNotice(null);
  }, [props.boardId, props.incidentId]);

  const editRecord = useCallback(() => {
    setEditingDirty(false);
    setEditing(true);
  }, []);
  const downloadAttachment = useCallback(async (fieldKey: string) => {
    const value = detail.data?.data[fieldKey];
    if (typeof value !== "string") return;
    const file = await props.client.downloadFile(value);
    saveBlob(file, resources.data?.attachments[fieldKey]?.name ?? "attachment");
  }, [detail.data, props.client, resources.data?.attachments]);
  const { reload: reloadView } = view;
  const { reload: reloadDetail } = detail;
  // The route object changes on every render; the record callbacks read it
  // through a ref so the record context is not republished each time.
  const routeRef = useRef(route);
  routeRef.current = route;
  const archiveRecord = useCallback(async (archived: boolean) => {
    if (!props.recordId) return;
    if (archived) await props.client.archiveRecord(props.boardId, props.recordId);
    else await props.client.restoreRecord(props.boardId, props.recordId);
    reloadDetail();
    reloadView();
  }, [props.boardId, props.client, props.recordId, reloadDetail, reloadView]);
  const deleteRecord = useCallback(async () => {
    if (!props.recordId) return;
    await props.client.deleteRecord(props.boardId, props.recordId);
    reloadView();
    const context = { ...routeRef.current.routeContext };
    delete context.recordId;
    routeRef.current.navigate({ kind: "board", id: props.boardId }, context);
  }, [props.boardId, props.client, props.recordId, reloadView]);
  const loadHistory = useCallback<HistoryPageLoader>((page) => props.recordId
    ? props.client.boardRecordHistory(props.boardId, props.recordId, incidentViewId, page)
    : Promise.resolve({ entries: [], nextCursor: null }),
  [incidentViewId, props.boardId, props.client, props.recordId]);

  useEffect(() => {
    if (!props.recordId) {
      props.onRecordContext?.(null);
      return;
    }
    if ((detail.loading && !detail.data) || (resources.loading && !resources.data)) {
      props.onRecordContext?.({ status: "loading" });
      return;
    }
    if (!detail.data || !resources.data || !board.data) {
      props.onRecordContext?.({ status: "missing" });
      return;
    }
    props.onRecordContext?.({
      status: "ready",
      record: detail.data.data,
      detail: detail.data,
      fields: board.data.fields,
      ...(board.data.detailLayout ? { layout: board.data.detailLayout } : {}),
      related: resources.data.related,
      attachments: resources.data.attachments,
      canEdit: detail.data.canEdit && board.data.canContribute,
      onEdit: editRecord,
      onDownloadAttachment: downloadAttachment,
      workflow: {
        client: props.client,
        boardId: props.boardId,
        recordId: detail.data.id,
        templateKey: board.data.templateKey,
        templateVersion: board.data.templateVersion,
        jurisdictionId: session.jurisdictionId,
        incidentId: detail.data.incidentId,
        canAct: board.data.canContribute,
        people: knownPeople(detail.data, session.me?.person ?? null),
        personId: session.me?.person.id ?? null,
      },
      lifecycle: {
        canArchive: detail.data.canEdit && board.data.canContribute,
        canDelete: board.data.role === "admin",
        onArchive: archiveRecord,
        onDelete: deleteRecord,
      },
      history: loadHistory,
    });
    return () => props.onRecordContext?.(null);
  }, [archiveRecord, board.data, deleteRecord, detail.data, detail.loading, downloadAttachment, editRecord, loadHistory, props.boardId, props.client, props.onRecordContext, props.recordId, resources.data, resources.loading, session.jurisdictionId, session.me]);

  if (board.loading && !board.data) return <Loading label="Loading board…" />;
  if (board.error && !board.data) return <ErrorNote message={board.error} />;
  if (!board.data) return null;

  const b = board.data;
  const canWrite = b.canContribute;
  const template: BoardTemplate = {
    key: b.templateKey,
    version: b.templateVersion,
    title: b.title,
    description: "",
    fields: [...b.fields],
    // The open view carries the refinement, so the table orders and filters
    // the rows exactly as the server read them.
    views: b.views.map((candidate) => candidate.key === viewKey ? refinedView(candidate, refinement) : candidate),
    ...(b.inputLayout ? { inputLayout: b.inputLayout } : {}),
    ...(b.detailLayout ? { detailLayout: b.detailLayout } : {}),
  };

  const navigateRecord = (recordId: string | null) => {
    const context = { ...route.routeContext };
    delete context.recordId;
    route.navigate({ kind: "board", id: props.boardId }, {
      ...context,
      ...(recordId ? { recordId } : {}),
    });
  };
  const selectView = (nextView: string) => {
    const context = { ...route.routeContext };
    delete context.recordId;
    delete context.filter;
    route.navigate({ kind: "board", id: props.boardId }, { ...context, view: nextView });
  };
  const saveFilter = (filter: string | null) => {
    const context = { ...route.routeContext };
    delete context.filter;
    route.navigate({ kind: "board", id: props.boardId }, { ...context, ...(filter ? { filter } : {}) });
  };
  async function submit(data: Record<string, unknown>) {
    const created = await props.client.createRecord(props.boardId, data, incidentViewId ?? undefined);
    setAdding(false);
    setAddingDirty(false);
    view.reload();
    navigateRecord(created.id);
  }
  async function update(data: Record<string, unknown>) {
    if (!props.recordId) return;
    await props.client.updateRecord(props.boardId, props.recordId, data, incidentViewId);
    setEditing(false);
    setEditingDirty(false);
    view.reload();
    detail.reload();
  }
  // A kanban move is an ordinary record update; the server applies the edit rules and its refusal is shown.
  async function moveRecord(recordId: string, field: string, value: string) {
    await props.client.updateRecord(props.boardId, recordId, { [field]: value }, incidentViewId);
    view.reload();
    if (recordId === props.recordId) detail.reload();
  }
  async function exportView(format: "csv" | "xlsx") {
    if (!viewKey) return;
    setNotice(null);
    try {
      saveBlob(await props.client.exportBoardView(props.boardId, viewKey, format, query), `${viewKey}.${format}`);
    } catch (reason) {
      setNotice(`The export failed: ${reason instanceof Error ? reason.message : "unknown error"}.`);
    }
  }
  const runImport: ImportRun = (file, options) => props.client.importBoardRecords(props.boardId, file, {
    ...options, ...(incidentViewId ? { incidentId: incidentViewId } : {}),
  });

  return (
    <Scroll>
      <SurfaceHeader
        title={b.title}
        actions={
          <div className="board-tools">
            {props.onDesign ? (
              <ActionButton kind="secondary" onClick={props.onDesign}>Customize board</ActionButton>
            ) : null}
            {canWrite ? (
              <ActionButton kind="primary" onClick={() => {
                setAddingDirty(false);
                setAdding(true);
              }}>
                <Icon name="add" decorative size={16} /> New record
              </ActionButton>
            ) : null}
          </div>
        }
      />
      {offline.data === false ? <p className="board-note" role="note">{OFFLINE_SYNC_UNAVAILABLE}</p> : null}
      {notice ? <p className="board-note" role="status">{notice}</p> : null}
      {viewKey ? (
        <BoardWorkspace
          client={props.client}
          boardId={props.boardId}
          template={template}
          viewKey={viewKey}
          records={loaded?.records ?? []}
          onLoadMore={loadMore}
          loading={view.loading && !view.data}
          error={view.error}
          personId={session.me?.person.id ?? null}
          incidentId={props.incidentId ?? null}
          selectedRecordId={props.recordId ?? null}
          routeFilter={route.routeContext.filter ?? null}
          onSelectView={selectView}
          onSelectRecord={navigateRecord}
          onFilter={saveFilter}
          onRetry={view.reload}
          refinement={refinement}
          onRefine={setRefinement}
          groups={view.data?.groups ?? null}
          mode={mode}
          onMode={setMode}
          canWrite={canWrite}
          workflow={workflow.loading && !workflow.data ? undefined : workflow.data}
          onMove={moveRecord}
          tools={<>
            <ActionButton onClick={() => void exportView("csv")}>Export CSV</ActionButton>
            <ActionButton onClick={() => void exportView("xlsx")}>Export Excel</ActionButton>
            {canWrite ? <ActionButton onClick={() => setImporting(true)}>Import records</ActionButton> : null}
          </>}
        />
      ) : view.loading ? (
        <Loading label="Loading records…" />
      ) : (
        <EmptyState label="This board has no display view." />
      )}
      {drafts.error ? <ErrorNote message={drafts.error} /> : null}
      <Drawer open={adding} title={`New ${b.title} record`} unsaved={addingDirty}
        onClose={() => setAdding(false)} onDiscard={() => {
          setAddingDirty(false);
          setAdding(false);
        }}>
        <RecordForm
          fields={b.fields}
          {...(b.inputLayout ? { layout: b.inputLayout } : {})}
          referenceOptions={resources.data?.referenceOptions ?? {}}
          {...(drafts.store && session.me && props.incidentId ? {
            draftStore: drafts.store,
            draftScope: boardDraftScope(session.me.person.id, props.incidentId, b, null),
          } : {})}
          onSubmit={submit}
          onDirtyChange={setAddingDirty}
          {...(session.jurisdictionId ? { onUpload: (file: File) => uploadPickedFile(props.client, session.jurisdictionId!, file) } : {})}
        />
      </Drawer>
      <Drawer open={editing && Boolean(detail.data)} title={`Edit ${b.title} record`}
        unsaved={editingDirty} onClose={() => setEditing(false)} onDiscard={() => {
          setEditingDirty(false);
          setEditing(false);
        }}>
        {detail.data ? (
          <RecordForm
            fields={b.fields}
            initial={detail.data.data}
            {...(b.inputLayout ? { layout: b.inputLayout } : {})}
            referenceOptions={resources.data?.referenceOptions ?? {}}
            {...(drafts.store && session.me && props.incidentId ? {
              draftStore: drafts.store,
              draftScope: boardDraftScope(session.me.person.id, props.incidentId, b, props.recordId ?? null),
            } : {})}
            onDirtyChange={setEditingDirty}
            submitLabel="Save changes"
            onSubmit={update}
            {...(session.jurisdictionId ? { onUpload: (file: File) => uploadPickedFile(props.client, session.jurisdictionId!, file) } : {})}
          />
        ) : null}
      </Drawer>
      <Drawer open={importing} title={`Import ${b.title} records`} onClose={() => setImporting(false)}>
        <BoardImport fields={b.fields} run={runImport} onImported={(created) => {
          setImporting(false);
          setNotice(`Imported ${created} record${created === 1 ? "" : "s"}.`);
          view.reload();
        }} />
      </Drawer>
    </Scroll>
  );
}

interface RecordResources {
  readonly referenceOptions: Readonly<Record<string, readonly { value: string; label: string }[]>>;
  readonly related: Readonly<Record<string, RecordReferenceOption>>;
  readonly attachments: Readonly<Record<string, FileMetaRef>>;
}

async function loadRecordResources(
  client: ApiClient,
  fields: readonly FieldDef[],
  detail: BoardRecordDetailResponse | null,
  boardId: string,
  incidentId?: string | null,
): Promise<RecordResources> {
  const references: Record<string, readonly RecordReferenceOption[]> = {};
  if (incidentId) {
    await Promise.all(fields.filter((field) => field.type === "record_ref").map(async (field) => {
      try {
        references[field.key] = await client.recordReferenceOptions(boardId, field.key, incidentId, { limit: 100 });
      } catch {
        // Omit the adapter when the endpoint is unavailable or denied. SchemaForm
        // then reports that this field cannot be edited instead of presenting an
        // authoritative-looking empty choice list.
      }
    }));
  }
  const related: Record<string, RecordReferenceOption> = {};
  for (const [fieldKey, options] of Object.entries(references)) {
    const selected = options.find((option) => option.id === detail?.data[fieldKey]);
    if (selected) related[fieldKey] = selected;
  }
  const attachments: Record<string, FileMetaRef> = {};
  if (detail) {
    await Promise.all(fields.filter((field) => field.type === "attachment").map(async (field) => {
      const fileId = detail.data[field.key];
      if (typeof fileId !== "string") return;
      const meta = await client.fileMeta(fileId).catch(() => null);
      if (meta) attachments[field.key] = meta;
    }));
  }
  return {
    referenceOptions: Object.fromEntries(Object.entries(references).map(([key, options]) => [
      key,
      options.map((option) => ({ value: option.id, label: option.label })),
    ])),
    related,
    attachments,
  };
}

function boardDraftScope(personId: string, incidentId: string, board: EffectiveBoardResponse, recordId: string | null) {
  return {
    personId,
    incidentId,
    formId: `board:${board.id}`,
    recordId,
    schema: `${board.templateKey}:${board.templateVersion}`,
  };
}

function BoardWorkspace(props: {
  readonly client: ApiClient;
  readonly boardId: string;
  readonly template: BoardTemplate;
  readonly viewKey: string;
  readonly records: readonly ViewRecord[];
  readonly onLoadMore: (() => Promise<void>) | undefined;
  readonly loading: boolean;
  readonly error: string | null;
  readonly personId: string | null;
  readonly incidentId: string | null;
  readonly selectedRecordId: string | null;
  readonly routeFilter: string | null;
  readonly onSelectView: (viewKey: string) => void;
  readonly onSelectRecord: (recordId: string | null) => void;
  readonly onFilter: (filter: string | null) => void;
  readonly onRetry: () => void;
  readonly refinement: ViewRefinement;
  readonly onRefine: (next: ViewRefinement) => void;
  readonly groups: ViewRecordsResponse["groups"] | null;
  readonly tools: ReactNode;
  readonly mode: BoardModeState;
  readonly onMode: (next: BoardModeState) => void;
  readonly canWrite: boolean;
  readonly workflow: BoardModeBodyProps["workflow"];
  readonly onMove: BoardModeBodyProps["onMove"];
}) {
  const view = props.template.views.find((candidate) => candidate.key === props.viewKey)!;
  const initial = useMemo(() => tableState(view.columns), [view.columns]);
  const routeFilters = useMemo(() => decodeFilters(view.columns, props.routeFilter), [props.routeFilter, view.columns]);
  const [viewState, setViewState] = useState(() => ({ ...initial, filters: routeFilters }));
  useEffect(() => setViewState((current) => {
    const sameColumns = current.columnOrder.length === initial.columnOrder.length
      && current.columnOrder.every((column, index) => column === initial.columnOrder[index]);
    const sameFilters = JSON.stringify(current.filters) === JSON.stringify(routeFilters);
    if (sameColumns && sameFilters) return current;
    return sameColumns ? { ...current, filters: routeFilters, page: 0 } : { ...initial, filters: routeFilters };
  }), [initial, routeFilters]);
  const updateView = (next: OperationalTableViewState, reason: string) => {
    setViewState(next);
    if (reason === "filter") props.onFilter(encodeFilters(next.filters));
  };
  const applySaved = useCallback((next: OperationalTableViewState) => {
    setViewState(next);
    props.onFilter(encodeFilters(next.filters));
  }, [props.onFilter]);

  const tabsId = `board-${props.template.key}-views`;
  return (
    <div className="board-surface">
      <Tabs id={tabsId} label="Board views"
        tabs={props.template.views.map((candidate) => ({ id: candidate.key, label: candidate.title }))}
        value={props.viewKey} onChange={props.onSelectView} />
      <div role="tabpanel" id={`${tabsId}-${props.viewKey}-panel`} aria-labelledby={`${tabsId}-${props.viewKey}-tab`} className="board-surface">
      <div className="board-tools">
        <ViewRefineControls fields={props.template.fields} value={props.refinement} onApply={props.onRefine} />
        {props.tools}
      </div>
      <BoardModeControls value={props.mode} fields={props.template.fields} onChange={props.onMode} />
      {props.mode.mode !== "list" ? (
        <BoardModeBody state={props.mode} onChange={props.onMode} fields={props.template.fields} columns={view.columns}
          records={props.records} groups={props.groups ?? null} loading={props.loading} error={props.error}
          onLoadMore={props.onLoadMore} canWrite={props.canWrite} workflow={props.workflow} onMove={props.onMove}
          onSelectRecord={props.onSelectRecord} selectedRecordId={props.selectedRecordId} />
      ) : <>
        {props.groups && view.groupBy ? (
          <GroupCounts field={props.template.fields.find((field) => field.key === view.groupBy)} groups={props.groups} />
        ) : null}
        {props.error && props.records.length > 0 ? (
          <p role="alert">Showing the last loaded records. {props.error}</p>
        ) : null}
        <BoardView
          template={props.template}
          viewKey={props.viewKey}
          records={props.records}
          viewState={viewState}
          onViewStateChange={updateView}
          selectedRecordId={props.selectedRecordId}
          onSelectRecord={props.onSelectRecord}
          {...(props.error && props.records.length === 0
            ? { status: "error" as const }
            : props.loading ? { status: "loading" as const } : {})}
          {...(props.error ? { errorMessage: props.error } : {})}
          {...(props.onLoadMore ? { onLoadMore: props.onLoadMore } : {})}
          onRetry={props.onRetry}
          toolbar={props.personId && props.incidentId ? (
            <PersistedViews client={props.client} personId={props.personId} incidentId={props.incidentId}
              tableId={`board.${props.boardId}.${props.template.key}.${props.viewKey}`}
              tableSchema={`${props.template.version}:${view.columns.join(",")}`}
              viewState={viewState} onApply={applySaved} />
          ) : <strong>{view.title}</strong>}
        />
      </>}
      </div>
    </div>
  );
}

function PersistedViews(props: {
  readonly client: ApiClient;
  readonly personId: string;
  readonly incidentId: string;
  readonly tableId: string;
  readonly tableSchema: string;
  readonly viewState: OperationalTableViewState;
  readonly onApply: (state: OperationalTableViewState) => void;
}) {
  const controller = useOperationalTableViews({
    persistence: props.client,
    personId: props.personId,
    incidentId: props.incidentId,
    tableId: props.tableId,
    tableSchema: props.tableSchema,
    onApply: props.onApply,
  });
  return <OperationalTableSavedViews controller={controller} viewState={props.viewState}
    scopeKey={`${props.personId}:${props.incidentId}:${props.tableId}:${props.tableSchema}`} />;
}

function tableState(columns: readonly string[]): OperationalTableViewState {
  return createOperationalTableViewState(columns.map((id) => ({ id })));
}

function decodeFilters(columns: readonly string[], encoded: string | null): Readonly<Record<string, string>> {
  if (!encoded) return {};
  const allowed = new Set(columns);
  const filters: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(encoded)) {
    if (allowed.has(key) && value.trim()) filters[key] = value.slice(0, 120);
  }
  return filters;
}

function encodeFilters(filters: Readonly<Record<string, string>>): string | null {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters).sort(([left], [right]) => left.localeCompare(right))) {
    if (value.trim()) query.set(key, value.trim());
  }
  const encoded = query.toString();
  return encoded && encoded.length <= 256 ? encoded : null;
}

export function BoardRecordDetailPane(props: {
  readonly context: Extract<BoardRecordContext, { readonly status: "ready" }>;
}) {
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [tab, setTab] = useState("record");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { context } = props;
  const fields = new Map(context.fields.map((field) => [field.key, field]));
  const sections = context.layout?.sections ?? [{ key: "details", title: "Details", fields: context.fields.map((field) => field.key) }];
  const lifecycle = context.lifecycle;
  const archivedAt = context.detail.archivedAt ?? null;
  async function act(run: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    try {
      await run();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "The server refused the change.");
    } finally {
      setBusy(false);
    }
  }
  const record = (
    <div className="board-record">
      {sections.map((section) => (
        <section key={section.key} aria-labelledby={`record-section-${section.key}`}>
          <h3 id={`record-section-${section.key}`} className="board-record-heading">{section.title}</h3>
          <dl className="eoc-shell-record-context">
            {section.fields.map((key) => {
              const field = fields.get(key);
              if (!field) return null;
              const value = context.record[key];
              const attachment = context.attachments[key];
              const related = context.related[key];
              return (
                <div key={key}>
                  <dt>{field.label}</dt>
                  <dd>{attachment ? (
                    <button type="button" className="eoc-btn" onClick={() => {
                      setDownloadError(null);
                      void context.onDownloadAttachment(key).catch((reason: unknown) =>
                        setDownloadError(reason instanceof Error ? reason.message : "Attachment could not be downloaded."));
                    }}>{attachment.name}</button>
                  ) : related ? related.label : formatDetailValue(value, field.type)}</dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
      {downloadError ? <p role="alert">{downloadError}</p> : null}
      {context.workflow ? <RecordWorkflowPanel key={context.workflow.recordId} source={context.workflow} /> : null}
      <section aria-labelledby="record-attribution-title">
        <h3 id="record-attribution-title" className="board-record-heading">Attribution</h3>
        <p>Created {formatDate(context.detail.createdAt)} by {actorLabel(context.detail.createdBy)}.</p>
        {context.detail.updatedBy ? <p>Updated {formatDate(context.detail.updatedAt)} by {actorLabel(context.detail.updatedBy)}.</p> : null}
      </section>
      <section aria-labelledby="record-history-title">
        <h3 id="record-history-title" className="board-record-heading">History</h3>
        {context.detail.history.length ? (
          <ol>{context.detail.history.map((entry) => (
            <li key={entry.id}>{formatDate(entry.at)} · {actorLabel(entry.actor)} · {historyLabel(entry.category, entry.payload, fields)}{entry.corrects ? " · correction" : ""}</li>
          ))}</ol>
        ) : <p>No attributed history is available.</p>}
      </section>
      {archivedAt ? <p role="status">Archived {formatDate(archivedAt)}. It is left out of default views until it is restored.</p> : null}
      <div className="board-record-actions">
        {context.canEdit ? <ActionButton kind="primary" onClick={context.onEdit}>Edit record</ActionButton> : null}
        {lifecycle?.canArchive ? <ActionButton loading={busy && !confirmDelete} disabled={busy}
          onClick={() => void act(() => lifecycle.onArchive(!archivedAt))}>
          {archivedAt ? "Restore record" : "Archive record"}
        </ActionButton> : null}
        {lifecycle?.canDelete ? <ActionButton kind="danger" disabled={busy} onClick={() => {
          setActionError(null);
          setConfirmDelete(true);
        }}>Delete record</ActionButton> : null}
      </div>
      {actionError && !confirmDelete ? <p role="alert">{actionError}</p> : null}
    </div>
  );
  const tabsId = `record-${context.detail.id}`;
  return (
    <div className="eoc-stack">
      {context.history ? <>
        <Tabs id={tabsId} label="Record detail" value={tab} onChange={setTab}
          tabs={[{ id: "record", label: "Record" }, { id: "history", label: "Change history" }]} />
        <div role="tabpanel" id={`${tabsId}-${tab}-panel`} aria-labelledby={`${tabsId}-${tab}-tab`}>
          {tab === "history"
            ? <RecordHistory key={`${context.detail.id}:${context.detail.updatedAt}:${archivedAt ?? ""}`}
              load={context.history} fields={context.fields} />
            : record}
        </div>
      </> : record}
      {lifecycle ? <ModalDialog open={confirmDelete} title="Delete this record?" onClose={() => setConfirmDelete(false)}
        footer={<>
          <ActionButton onClick={() => setConfirmDelete(false)}>Keep record</ActionButton>
          <ActionButton kind="danger" loading={busy} loadingLabel="Deleting…"
            onClick={() => void act(lifecycle.onDelete)}>Delete record</ActionButton>
        </>}>
        <p>Deleting takes the record out of every view, map, export and offline copy. The deletion is recorded in
          its history with the values it held, and it cannot be undone from this screen.</p>
        {actionError ? <p role="alert">{actionError}</p> : null}
      </ModalDialog> : null}
    </div>
  );
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatDetailValue(value: unknown, type: FieldDef["type"]): string {
  if (value === undefined || value === null || value === "") return "Unavailable";
  if (type === "boolean") return value ? "Yes" : "No";
  if (type === "attachment") return "Attachment unavailable";
  if (type === "record_ref") return `Related record ${String(value)}`;
  if (type === "enum") return choiceLabel(String(value));
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function knownPeople(
  detail: BoardRecordDetailResponse,
  me: { readonly id: string; readonly displayName: string } | null,
): Record<string, string> {
  const people: Record<string, string> = {};
  for (const actor of [detail.createdBy, detail.updatedBy, ...detail.history.map((entry) => entry.actor)]) {
    if (actor) people[actor.personId] = actor.displayName;
  }
  if (me) people[me.id] = me.displayName;
  return people;
}

function actorLabel(actor: BoardRecordDetailResponse["createdBy"]): string {
  const role = [actor.positionTitle, actor.organizationName].filter(Boolean).join(" · ");
  return role ? `${actor.displayName} (${role})` : actor.displayName;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function historyLabel(
  category: string,
  payload: Record<string, unknown>,
  fieldDefinitions: ReadonlyMap<string, FieldDef>,
): string {
  const changedFields = Array.isArray(payload["fields"])
    ? (payload["fields"] as unknown[]).filter((field): field is string => typeof field === "string")
    : [];
  const action = category === "board.record.created" ? "Created record"
    : category === "board.record.updated" ? "Updated record"
      : category.replaceAll(".", " ");
  return changedFields.length
    ? `${action}: ${changedFields.map((key) => fieldDefinitions.get(key)?.label ?? key).join(", ")}`
    : action;
}
