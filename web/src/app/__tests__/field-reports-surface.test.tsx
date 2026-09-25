// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, BoardListItem } from "../api/client.js";
import { PageChromeContext } from "../layout/page-chrome.js";
import { FieldReportsSurface } from "../surfaces/FieldReportsSurface.js";

const board = (id: string, templateKey: string, title = id): BoardListItem =>
  ({ id, title, templateKey, templateVersion: 2, hasGeometry: true });
const BOARDS = [board("shelters", "shelters"), board("org-reports", "field_reports", "Org reports"), board("fire-reports", "field_reports", "Fire reports")];

const RECORDS = [
  { id: "r1", summary: "Culvert washout", category: "hazard", location: { type: "Point", coordinates: [-124.1, 40.8] },
    createdAt: "2026-09-24T16:10:00.000Z", createdByName: "Taylor Kim" },
  { id: "r2", summary: "Tree on Dows Prairie Rd", category: "damage", verified: true,
    createdAt: "2026-09-24T15:00:00.000Z", createdByName: "L. Moreno" },
];

function stubClient() {
  return {
    boardViewPage: vi.fn(async () => ({ view: "all", columns: ["summary"], records: RECORDS, nextCursor: null })),
    updateRecord: vi.fn(async () => ({ ok: true as const })),
  };
}

function withPageHeader(children: ReactNode) {
  const actions = document.createElement("div");
  document.body.append(actions);
  return <PageChromeContext.Provider value={{ actions, subtitle: null }}>{children}</PageChromeContext.Provider>;
}

function renderSurface(overrides: Partial<Parameters<typeof FieldReportsSurface>[0]> = {}) {
  const client = stubClient();
  const handlers = { onOpenSmartForms: vi.fn(), onOpenRecord: vi.fn(), onOpenMap: vi.fn() };
  const view = render(withPageHeader(
    <FieldReportsSurface client={client as unknown as ApiClient} boards={BOARDS} boardsLoading={false} incidentId={null}
      incidentBoardIds={new Set()} period={null} {...handlers} {...overrides} />,
  ));
  return { client, ...handlers, view };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("field reports surface", () => {
  it("reads the incident's own Field Reports board, scoped to the incident", async () => {
    const { client } = renderSurface({ incidentId: "incident-1", incidentBoardIds: new Set(["fire-reports", "shelters"]) });
    await screen.findByRole("heading", { name: "Fire reports" });
    expect(client.boardViewPage).toHaveBeenCalledWith("fire-reports", "all", { incidentId: "incident-1" }, { limit: 500 });
    expect(screen.queryByLabelText("Field Reports board")).toBeNull();
  });

  it("offers every Field Reports board in the organization when none is attached", async () => {
    const { client } = renderSurface();
    await screen.findByRole("heading", { name: "Org reports" });
    fireEvent.change(screen.getByLabelText("Field Reports board"), { target: { value: "fire-reports" } });
    await screen.findByRole("heading", { name: "Fire reports" });
    expect(client.boardViewPage).toHaveBeenLastCalledWith("fire-reports", "all", {}, { limit: 500 });
  });

  it("lists unverified reports first with their reporter, and verifies one", async () => {
    const { client } = renderSurface();
    const report = await screen.findByRole("button", { name: "Report: Culvert washout" });
    expect(screen.queryByRole("button", { name: "Report: Tree on Dows Prairie Rd" })).toBeNull();
    expect(report.textContent).toContain("Taylor Kim");
    fireEvent.click(report);
    fireEvent.click(screen.getByRole("button", { name: "Verify report" }));
    await waitFor(() => expect(client.updateRecord).toHaveBeenCalledWith("org-reports", "r1", { verified: true }, null));
    await screen.findByText("Every report is verified.");
    fireEvent.click(screen.getByRole("button", { name: "All (2)" }));
    expect(screen.getByRole("button", { name: "Report: Tree on Dows Prairie Rd" })).not.toBeNull();
  });

  it("counts the reports received in the selected operational period", async () => {
    renderSurface({ period: { revision: 1, label: "OP 1", startsAt: "2026-09-24T16:00:00.000Z", endsAt: "2026-09-25T04:00:00.000Z" } });
    const counts = await screen.findByLabelText("Field report counts");
    expect(counts.textContent).toContain("This period1");
  });

  it("finds a report on the map and opens its record", async () => {
    const { onOpenMap, onOpenRecord } = renderSurface();
    fireEvent.click(await screen.findByRole("button", { name: "Report: Culvert washout" }));
    fireEvent.click(screen.getByRole("button", { name: "Show on map" }));
    expect(onOpenMap).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Open record" }));
    expect(onOpenRecord).toHaveBeenCalledWith("org-reports", "r1");
  });

  it("opens Smart Forms to capture a report", async () => {
    const { onOpenSmartForms } = renderSurface();
    fireEvent.click(await screen.findByRole("button", { name: "Capture a field report" }));
    expect(onOpenSmartForms).toHaveBeenCalledOnce();
  });

  it("waits for the board list, then says when no Field Reports board exists", () => {
    const { view } = renderSurface({ boards: [], boardsLoading: true });
    screen.getByText("Loading field reports…");
    view.rerender(withPageHeader(
      <FieldReportsSurface client={stubClient() as unknown as ApiClient} boards={[BOARDS[0]!]} boardsLoading={false} incidentId={null}
        incidentBoardIds={new Set()} period={null} onOpenSmartForms={vi.fn()} onOpenRecord={vi.fn()} onOpenMap={vi.fn()} />,
    ));
    screen.getByText("No Field Reports board");
  });
});
