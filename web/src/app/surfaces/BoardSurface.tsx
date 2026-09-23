import { useCallback, useEffect, useMemo, useState } from "react";
import type { BoardTemplate, FieldDef, FormLayout, ViewRecord } from "@openeoc/shared";
import { BoardView } from "../../boards/BoardView.js";
import { RecordForm } from "../../boards/RecordForm.js";
import { ActionButton, Tabs } from "../../design/controls.js";
import { createMetadataDraftStore, type ScopedDraftStore } from "../../design/form-drafts.js";
import { Drawer } from "../../design/overlays.js";
import { Icon } from "../../design/icons/Icon.js";
import {
  createOperationalTableViewState,
  type OperationalTableViewState,
} from "../../design/table.js";
import { OperationalTableSavedViews, useOperationalTableViews } from "../../design/table-saved-views.js";
import { openOfflineStore } from "../../offline/store.js";
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
 * viewer sees the data with no write affordance.
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
  const view = useAsync(
    () => (viewKey ? props.client.boardView(props.boardId, viewKey, incidentViewId ?? undefined) : Promise.resolve(null)),
    [incidentViewId, props.boardId, viewKey],
  );
  // Pages added with "Load more" extend the first page they were read after,
  // so a reload or a view change starts again from the newest records.
  const [more, setMore] = useState<{ base: ViewRecordsResponse; records: readonly ViewRecord[]; nextCursor: string | null } | null>(null);
  const loaded = view.data && more?.base === view.data ? more
    : view.data ? { base: view.data, records: view.data.records, nextCursor: view.data.nextCursor ?? null } : null;
  const nextCursor = loaded?.nextCursor ?? null;
  const loadMore = loaded && nextCursor && viewKey ? async () => {
    const next = await props.client.boardView(props.boardId, viewKey, incidentViewId ?? undefined, { cursor: nextCursor });
    setMore({ base: loaded.base, records: [...loaded.records, ...next.records], nextCursor: next.nextCursor });
  } : undefined;
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
  const drafts = useBoardDraftStore(props.draftStore);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [addingDirty, setAddingDirty] = useState(false);
  const [editingDirty, setEditingDirty] = useState(false);

  useEffect(() => {
    setAdding(false);
    setEditing(false);
    setAddingDirty(false);
    setEditingDirty(false);
  }, [props.boardId, props.incidentId, props.recordId]);

  const editRecord = useCallback(() => {
    setEditingDirty(false);
    setEditing(true);
  }, []);
  const downloadAttachment = useCallback(async (fieldKey: string) => {
    const value = detail.data?.data[fieldKey];
    if (typeof value !== "string") return;
    const file = await props.client.downloadFile(value);
    const name = resources.data?.attachments[fieldKey]?.name ?? "attachment";
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [detail.data, props.client, resources.data?.attachments]);

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
    });
    return () => props.onRecordContext?.(null);
  }, [board.data, detail.data, detail.loading, downloadAttachment, editRecord, props.onRecordContext, props.recordId, resources.data, resources.loading]);

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
    views: [...b.views],
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

  return (
    <Scroll>
      <SurfaceHeader
        title={b.title}
        actions={
          <>
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
          </>
        }
      />
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

function useBoardDraftStore(injected?: ScopedDraftStore): { store: ScopedDraftStore | null; error: string | null } {
  const [local, setLocal] = useState<ScopedDraftStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (injected) return;
    if (typeof indexedDB === "undefined") {
      setError("Draft storage is unavailable in this browser.");
      return;
    }
    let active = true;
    let close: (() => void) | null = null;
    void openOfflineStore().then((store) => {
      close = store.close;
      if (!active) {
        store.close();
        return;
      }
      setLocal(createMetadataDraftStore(store));
      setError(null);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Draft storage is unavailable.");
    });
    return () => {
      active = false;
      close?.();
    };
  }, [injected]);
  return { store: injected ?? local, error };
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

  return (
    <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
      <Tabs id={`board-${props.template.key}-views`} label="Board views"
        tabs={props.template.views.map((candidate) => ({ id: candidate.key, label: candidate.title }))}
        value={props.viewKey} onChange={props.onSelectView} />
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
  const { context } = props;
  const fields = new Map(context.fields.map((field) => [field.key, field]));
  const sections = context.layout?.sections ?? [{ key: "details", title: "Details", fields: context.fields.map((field) => field.key) }];
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {sections.map((section) => (
        <section key={section.key} aria-labelledby={`record-section-${section.key}`}>
          <h3 id={`record-section-${section.key}`} style={{ fontSize: "0.9rem", margin: "0 0 6px" }}>{section.title}</h3>
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
      <section aria-labelledby="record-attribution-title">
        <h3 id="record-attribution-title" style={{ fontSize: "0.9rem", margin: "0 0 6px" }}>Attribution</h3>
        <p>Created {formatDate(context.detail.createdAt)} by {actorLabel(context.detail.createdBy)}.</p>
        {context.detail.updatedBy ? <p>Updated {formatDate(context.detail.updatedAt)} by {actorLabel(context.detail.updatedBy)}.</p> : null}
      </section>
      <section aria-labelledby="record-history-title">
        <h3 id="record-history-title" style={{ fontSize: "0.9rem", margin: "0 0 6px" }}>History</h3>
        {context.detail.history.length ? (
          <ol>{context.detail.history.map((entry) => (
            <li key={entry.id}>{formatDate(entry.at)} · {actorLabel(entry.actor)} · {historyLabel(entry.category, entry.payload, fields)}{entry.corrects ? " · correction" : ""}</li>
          ))}</ol>
        ) : <p>No attributed history is available.</p>}
      </section>
      {context.canEdit ? <ActionButton kind="primary" onClick={context.onEdit}>Edit record</ActionButton> : null}
    </div>
  );
}

function formatDetailValue(value: unknown, type: FieldDef["type"]): string {
  if (value === undefined || value === null || value === "") return "Unavailable";
  if (type === "boolean") return value ? "Yes" : "No";
  if (type === "attachment") return "Attachment unavailable";
  if (type === "record_ref") return `Related record ${String(value)}`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function actorLabel(actor: BoardRecordDetailResponse["createdBy"]): string {
  return actor.positionTitle ? `${actor.displayName} (${actor.positionTitle})` : actor.displayName;
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
