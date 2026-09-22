// @vitest-environment jsdom
import { useState } from "react";
import { STANDARD_TEMPLATES, type ViewRecord } from "@openeoc/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOperationalTableViewState, type OperationalTableViewState } from "../../design/table.js";
import type { BoardRecordDetailResponse } from "../../app/api/client.js";
import { BoardRecordDetailPane, type BoardRecordContext } from "../../app/surfaces/BoardSurface.js";
import { BoardView } from "../BoardView.js";
import { RecordForm } from "../RecordForm.js";

const shelters = STANDARD_TEMPLATES.find((template) => template.key === "shelters")!;
const records: ViewRecord[] = [
  { id: "record-1", name: "Hoopa High Gym", status: "normal", capacity: 150, occupancy: 112 },
  { id: "record-2", name: "Closed Hall", status: "closed", capacity: 40, occupancy: 0 },
];

afterEach(cleanup);

function ControlledBoard(props: { onSelect: (id: string | null) => void }) {
  const view = shelters.views.find((candidate) => candidate.key === "all")!;
  const [state, setState] = useState<OperationalTableViewState>(() =>
    createOperationalTableViewState(view.columns.map((id) => ({ id }))));
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <BoardView
      template={shelters}
      viewKey="all"
      records={records}
      viewState={state}
      onViewStateChange={setState}
      selectedRecordId={selected}
      onSelectRecord={(id) => {
        setSelected(id);
        props.onSelect(id);
      }}
    />
  );
}

describe("P-BOARDS-1 board workspace", () => {
  it("filters the operational table, keeps zero distinct, and selects a record", () => {
    const onSelect = vi.fn();
    render(<ControlledBoard onSelect={onSelect} />);
    expect(screen.getByText("Hoopa High Gym")).toBeTruthy();
    expect(screen.getByText("0", { exact: true })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filter Shelter"), { target: { value: "Closed" } });
    expect(screen.queryByText("Hoopa High Gym")).toBeNull();
    expect(screen.getByText("Closed Hall")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Select record record-2"));
    expect(onSelect).toHaveBeenLastCalledWith("record-2");
  });

  it("uses the 81A input layout and preserves values after an awaited rejection", async () => {
    const onSubmit = vi.fn(async () => { throw new Error("Write authority changed"); });
    render(
      <RecordForm
        fields={shelters.fields}
        layout={{ sections: [{ key: "request", title: "Shelter request", fields: ["name", "status", "capacity", "occupancy"] }] }}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByText("Shelter request")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Shelter"), { target: { value: "Hoopa High Gym" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "normal" } });
    fireEvent.change(screen.getByLabelText("Capacity"), { target: { value: "150" } });
    fireEvent.change(screen.getByLabelText("Occupancy"), { target: { value: "112" } });
    fireEvent.click(screen.getByRole("button", { name: "Save record" }));
    await screen.findByText(/Write authority changed/);
    expect((screen.getByLabelText("Shelter") as HTMLTextAreaElement).value).toBe("Hoopa High Gym");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("renders layout, related records, attachments, attribution and immutable history", async () => {
    const onEdit = vi.fn();
    const onDownload = vi.fn(async () => undefined);
    const detail: BoardRecordDetailResponse = {
      id: "record-2",
      incidentId: "incident-1",
      data: records[1]!,
      createdAt: "2026-09-21T15:00:00.000Z",
      createdBy: { personId: "person-1", displayName: "A. Operator", positionId: "position-1", positionTitle: "Operations" },
      updatedAt: "2026-09-21T16:00:00.000Z",
      updatedBy: { personId: "person-2", displayName: "B. Operator", positionId: null, positionTitle: null },
      canEdit: true,
      history: [{
        id: "history-1",
        at: "2026-09-21T16:00:00.000Z",
        category: "board.record.updated",
        actor: { personId: "person-2", displayName: "B. Operator", positionId: null, positionTitle: null },
        payload: { fields: ["occupancy"] },
        corrects: null,
      }],
    };
    const photoField = { key: "photo", label: "Photo", type: "attachment" as const, required: false, read: "any" as const, write: "member" as const };
    const relatedField = { key: "request", label: "Related request", type: "record_ref" as const, required: false, read: "any" as const, write: "member" as const, targetBoardKey: "resource_request", labelField: "item" };
    const context: Extract<BoardRecordContext, { status: "ready" }> = {
      status: "ready",
      record: { ...detail.data, photo: "file-1", request: "related-1" },
      detail: { ...detail, data: { ...detail.data, photo: "file-1", request: "related-1" } },
      fields: [...shelters.fields, photoField, relatedField],
      layout: { sections: [{ key: "summary", title: "Summary", fields: ["name", "occupancy", "photo", "request"] }] },
      related: { request: { id: "related-1", label: "500 sandbags", boardId: "board-2" } },
      attachments: { photo: { id: "file-1", name: "shelter.jpg", contentType: "image/jpeg", size: 42, version: 1 } },
      canEdit: true,
      onEdit,
      onDownloadAttachment: onDownload,
    };
    render(<BoardRecordDetailPane context={context} />);
    expect(screen.getByText("Summary")).toBeTruthy();
    expect(screen.getByText("500 sandbags")).toBeTruthy();
    expect(screen.getByText(/A\. Operator \(Operations\)/)).toBeTruthy();
    expect(screen.getByText(/Updated record: Occupancy/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "shelter.jpg" }));
    await waitFor(() => expect(onDownload).toHaveBeenCalledWith("photo"));
    fireEvent.click(screen.getByRole("button", { name: "Edit record" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
