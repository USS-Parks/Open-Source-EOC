import { useState } from "react";
import type { CreateRecordPanelData, DashboardPanelSnapshot } from "@openeoc/shared";
import type { EffectiveBoardResponse } from "../app/api/client.js";
import { RecordForm } from "../boards/RecordForm.js";
import { ActionButton } from "../design/controls.js";
import { ErrorState, LoadingState } from "../design/feedback.js";
import { Icon } from "../design/icons/index.js";
import { Drawer } from "../design/overlays.js";

/** What a create-record tile needs from the console: a board's form, and the save to the incident. */
export interface CreateRecordActions {
  readonly loadBoard: (boardId: string) => Promise<EffectiveBoardResponse>;
  readonly create: (boardId: string, data: Record<string, unknown>) => Promise<{ readonly id: string }>;
  readonly upload?: ((file: File) => Promise<string>) | undefined;
  readonly onCreated?: (() => void) | undefined;
}

/**
 * A create-record tile (VC-24): the board's own record form opens in a
 * drawer over the dashboard, starting from the tile's presets, and saves the
 * record to the incident without leaving the dashboard. A viewer who cannot
 * write to the board sees the tile with its button disabled and the reason;
 * the server refuses the write whatever the screen does.
 */
export function CreateRecordTile(props: {
  readonly panel: DashboardPanelSnapshot;
  readonly data: CreateRecordPanelData;
  readonly actions?: CreateRecordActions | undefined;
}) {
  const { panel, data, actions } = props;
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [board, setBoard] = useState<EffectiveBoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const start = () => {
    if (!actions) return;
    setOpen(true);
    setNotice("");
    if (board) return;
    setError(null);
    actions.loadBoard(data.boardId).then(setBoard)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };
  const save = async (values: Record<string, unknown>) => {
    await actions!.create(data.boardId, values);
    setDirty(false);
    setOpen(false);
    setNotice(`Record saved to ${data.boardTitle}.`);
    actions!.onCreated?.();
  };

  return (
    <>
      <article className="eoc-kit-card eoc-kit-kpi-card p-dash-create-tile" data-testid={`panel-${panel.key}`} aria-label={panel.title}>
        <div className="eoc-kit-card-leading"><Icon name="add" decorative size={24} /></div>
        <div className="eoc-kit-kpi-content">
          <span className="eoc-kit-card-eyebrow">{data.boardTitle}</span>
          <ActionButton kind="primary" disabled={!data.canCreate || !actions} onClick={start}>{panel.title}</ActionButton>
          {data.presets.length ? <p>Starts with {data.presets.map((preset) => `${preset.label}: ${preset.text}`).join(", ")}</p> : null}
          {panel.reason ? <p>{panel.reason}</p> : null}
          {notice ? <p role="status">{notice}</p> : null}
        </div>
      </article>
      <Drawer open={open} title={panel.title} unsaved={dirty} onClose={() => setOpen(false)} onDiscard={() => setDirty(false)}>
        {error ? <ErrorState title={`Could not load the ${data.boardTitle} form`} message={error} /> : null}
        {!board && !error ? <LoadingState label={`Loading the ${data.boardTitle} form`} lines={4} /> : null}
        {board ? (
          <RecordForm
            fields={board.fields}
            {...(board.inputLayout ? { layout: board.inputLayout } : {})}
            initial={Object.fromEntries(data.presets.map((preset) => [preset.field, preset.value]))}
            submitLabel="Save record"
            onDirtyChange={setDirty}
            onSubmit={save}
            {...(actions?.upload ? { onUpload: actions.upload } : {})}
          />
        ) : null}
      </Drawer>
    </>
  );
}
