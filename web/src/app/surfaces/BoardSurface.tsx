import { useState } from "react";
import type { BoardTemplate } from "@openeoc/shared";
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
export function BoardSurface(props: { client: ApiClient; boardId: string }) {
  const board = useAsync(() => props.client.getBoard(props.boardId), [props.boardId]);
  const viewKey = board.data?.views[0]?.key ?? null;
  const view = useAsync(
    () => (viewKey ? props.client.boardView(props.boardId, viewKey) : Promise.resolve(null)),
    [props.boardId, viewKey],
  );
  const [adding, setAdding] = useState(false);

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
