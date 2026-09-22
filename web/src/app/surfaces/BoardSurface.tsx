import { useEffect, useState } from "react";
import type { BoardTemplate, ViewRecord } from "@openeoc/shared";
import { BoardView } from "../../boards/BoardView.js";
import { RecordForm } from "../../boards/RecordForm.js";
import { Button, Panel } from "../../design/components.js";
import type { ApiClient } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { EmptyState, ErrorNote, Loading, Scroll, SurfaceHeader } from "../screens/parts.js";

/**
 * A single board: its first display view rendered as a table, with a record
 * form for writers. Validation uses the same shared schema the server
 * enforces, so the form can never submit what the server would refuse; a
 * viewer sees the data with no write affordance.
 */
export type BoardRecordContext =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly record: ViewRecord }
  | { readonly status: "missing" };

export function BoardSurface(props: {
  client: ApiClient;
  boardId: string;
  incidentId?: string | null;
  recordId?: string;
  onRecordContext?: (state: BoardRecordContext | null) => void;
}) {
  const board = useAsync(() => props.client.getBoard(props.boardId), [props.boardId]);
  const viewKey = board.data?.views[0]?.key ?? null;
  const view = useAsync(
    () => (viewKey ? props.client.boardView(props.boardId, viewKey) : Promise.resolve(null)),
    [props.boardId, viewKey],
  );
  const recordView = useAsync(
    () => (props.recordId && props.incidentId && viewKey
      ? props.client.boardView(props.boardId, viewKey, props.incidentId)
      : Promise.resolve(null)),
    [props.boardId, props.incidentId, props.recordId, viewKey],
  );
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!props.recordId) {
      props.onRecordContext?.(null);
      return;
    }
    if (recordView.loading && !recordView.data) {
      props.onRecordContext?.({ status: "loading" });
      return;
    }
    const record = recordView.data?.records.find((candidate) => candidate.id === props.recordId);
    props.onRecordContext?.(record ? { status: "ready", record } : { status: "missing" });
    return () => props.onRecordContext?.(null);
  }, [props.boardId, props.onRecordContext, props.recordId, recordView.data, recordView.error, recordView.loading, viewKey]);

  if (board.loading && !board.data) return <Loading label="Loading board…" />;
  if (board.error && !board.data) return <ErrorNote message={board.error} />;
  if (!board.data) return null;

  const b = board.data;
  const canWrite = b.role === "admin" || b.role === "member";
  const template: BoardTemplate = {
    key: b.templateKey,
    version: b.templateVersion,
    title: b.title,
    description: "",
    fields: [...b.fields],
    views: [...b.views],
  };

  async function submit(data: Record<string, unknown>) {
    await props.client.createRecord(props.boardId, data);
    setAdding(false);
    view.reload();
  }

  return (
    <Scroll>
      <SurfaceHeader
        title={b.title}
        actions={
          canWrite ? (
            <Button kind={adding ? "quiet" : "primary"} onClick={() => setAdding((v) => !v)}>
              {adding ? "Cancel" : "New record"}
            </Button>
          ) : null
        }
      />
      {adding ? (
        <div style={{ marginBottom: 16 }}>
          <Panel title={`New ${b.title} record`}>
            <RecordForm fields={b.fields} onSubmit={(d) => void submit(d)} />
          </Panel>
        </div>
      ) : null}
      {view.error ? <ErrorNote message={view.error} /> : null}
      {viewKey && view.data ? (
        <BoardView template={template} viewKey={viewKey} records={view.data.records} />
      ) : view.loading ? (
        <Loading label="Loading records…" />
      ) : (
        <EmptyState label="This board has no display view." />
      )}
    </Scroll>
  );
}
