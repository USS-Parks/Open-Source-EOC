// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, BoardListItem } from "../api/client.js";
import { FieldReportsSurface } from "../surfaces/FieldReportsSurface.js";

vi.mock("../surfaces/BoardSurface.js", () => ({
  BoardSurface: (props: { boardId: string; incidentScoped?: boolean }) => (
    <p data-testid="board">{props.boardId} {props.incidentScoped ? "incident" : "organization"}</p>
  ),
}));

const board = (id: string, templateKey: string, title = id): BoardListItem =>
  ({ id, title, templateKey, templateVersion: 1, hasGeometry: true });
const BOARDS = [board("shelters", "shelters"), board("org-reports", "field_reports"), board("fire-reports", "field_reports")];
const client = {} as ApiClient;

afterEach(cleanup);

describe("field reports surface", () => {
  it("shows the incident's own Field Reports board, scoped to the incident", () => {
    render(<FieldReportsSurface client={client} boards={BOARDS} boardsLoading={false} incidentId="incident-1"
      incidentBoardIds={new Set(["fire-reports", "shelters"])} onOpenSmartForms={vi.fn()} />);
    expect(screen.getByTestId("board").textContent).toBe("fire-reports incident");
    expect(screen.queryByLabelText("Field Reports board")).toBeNull();
  });

  it("offers every Field Reports board in the organization when none is attached", () => {
    render(<FieldReportsSurface client={client} boards={BOARDS} boardsLoading={false} incidentId={null}
      incidentBoardIds={new Set()} onOpenSmartForms={vi.fn()} />);
    expect(screen.getByTestId("board").textContent).toBe("org-reports organization");
    fireEvent.change(screen.getByLabelText("Field Reports board"), { target: { value: "fire-reports" } });
    expect(screen.getByTestId("board").textContent).toBe("fire-reports organization");
  });

  it("opens Smart Forms to capture a report", () => {
    const onOpenSmartForms = vi.fn();
    render(<FieldReportsSurface client={client} boards={BOARDS} boardsLoading={false} incidentId={null}
      incidentBoardIds={new Set()} onOpenSmartForms={onOpenSmartForms} />);
    fireEvent.click(screen.getByRole("button", { name: "Capture a field report" }));
    expect(onOpenSmartForms).toHaveBeenCalledOnce();
  });

  it("waits for the board list, then says when no Field Reports board exists", () => {
    const view = render(<FieldReportsSurface client={client} boards={[]} boardsLoading incidentId={null}
      incidentBoardIds={new Set()} onOpenSmartForms={vi.fn()} />);
    screen.getByText("Loading field reports…");
    view.rerender(<FieldReportsSurface client={client} boards={[BOARDS[0]!]} boardsLoading={false} incidentId={null}
      incidentBoardIds={new Set()} onOpenSmartForms={vi.fn()} />);
    screen.getByText("No Field Reports board");
    expect(screen.queryByTestId("board")).toBeNull();
  });
});
