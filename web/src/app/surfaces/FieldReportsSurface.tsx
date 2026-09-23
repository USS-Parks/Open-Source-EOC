import { useState } from "react";
import { ActionButton } from "../../design/controls.js";
import { EmptyState } from "../../design/feedback.js";
import { Icon } from "../../design/icons/Icon.js";
import type { ApiClient, BoardListItem } from "../api/client.js";
import { Loading } from "../screens/parts.js";
import { BoardSurface } from "./BoardSurface.js";

/** The standard board template that field capture, Smart Forms and offline sync write reports to. */
const FIELD_REPORTS_TEMPLATE = "field_reports";

/**
 * Field reports as they arrive: the Field Reports board attached to the
 * selected incident, or every Field Reports board in the organization when
 * none is attached or no incident is selected. The board engine renders the
 * records, so status, attachments and the record link behave exactly as they
 * do under Boards.
 */
export function FieldReportsSurface(props: {
  client: ApiClient;
  boards: readonly BoardListItem[];
  boardsLoading: boolean;
  incidentId: string | null;
  incidentBoardIds: ReadonlySet<string>;
  onOpenSmartForms: () => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const reportBoards = props.boards.filter((board) => board.templateKey === FIELD_REPORTS_TEMPLATE);
  const attached = reportBoards.filter((board) => props.incidentBoardIds.has(board.id));
  const candidates = attached.length > 0 ? attached : reportBoards;
  const board = candidates.find((candidate) => candidate.id === chosen) ?? candidates[0];

  if (!board) {
    return props.boardsLoading ? <Loading label="Loading field reports…" /> : (
      <EmptyState title="No Field Reports board"
        description="Field reports are kept on a board made from the Field Reports template. Ask an administrator to create one for this organization." />
    );
  }
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 12, padding: "16px 16px 0" }}>
        <p style={{ flex: "1 1 280px", margin: 0, color: "var(--eoc-text-muted)" }}>
          Reports from Smart Forms, field capture and offline sync arrive here. Select a report to open its record.
        </p>
        {candidates.length > 1 ? (
          <label style={{ display: "grid", gap: 4 }}>
            Field Reports board
            <select value={board.id} onChange={(event) => setChosen(event.target.value)}>
              {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
            </select>
          </label>
        ) : null}
        <ActionButton kind="secondary" onClick={props.onOpenSmartForms}>
          <Icon name="smartForms" decorative size={16} /> Capture a field report
        </ActionButton>
      </div>
      <BoardSurface key={board.id} client={props.client} boardId={board.id} incidentId={props.incidentId}
        incidentScoped={Boolean(props.incidentId) && props.incidentBoardIds.has(board.id)} />
    </>
  );
}
