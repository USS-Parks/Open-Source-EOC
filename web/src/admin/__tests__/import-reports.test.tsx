// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, expect, it, vi } from "vitest";
import type { ApiClient, ImportReport, ImportReportSummary } from "../../app/api/client.js";
import { ImportReports } from "../ImportReports.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const webeoc: ImportReportSummary = {
  id: "r1", kind: "webeoc", subject: "Significant Events", sourceName: "events.csv",
  read: 3, created: 2, updated: 0, skipped: 0, refused: 1, runBy: "Member", runAt: "2026-09-25T17:00:00Z", signOff: null,
};
const people: ImportReportSummary = {
  id: "r2", kind: "people", subject: "Accounts and positions", sourceName: "staff.csv",
  read: 2, created: 1, updated: 1, skipped: 0, refused: 0, runBy: "Admin", runAt: "2026-09-25T16:00:00Z",
  signOff: { by: "Admin", at: "2026-09-25T16:30:00Z", note: null },
};
const detail: ImportReport = {
  ...webeoc,
  mapping: [{ field: "Summary", column: "Summary" }, { field: "Severity", column: "sev" }],
  rows: [
    { row: 2, item: "dataid 11", outcome: "created" },
    { row: 3, item: "dataid 12", outcome: "refused", reason: "Summary is required and this row leaves it empty" },
    { row: 4, item: "dataid 13", outcome: "created" },
  ],
};

it("lists each import with its counts and sign-off, opens one, filters its rows and signs it off", async () => {
  const client = {
    listImportReports: vi.fn().mockResolvedValue({ reports: [webeoc, people], nextCursor: null }),
    getImportReport: vi.fn().mockResolvedValueOnce(detail)
      .mockResolvedValue({ ...detail, signOff: { by: "Admin", at: "2026-09-25T18:00:00Z", note: "Checked against WebEOC." } }),
    signOffImportReport: vi.fn().mockResolvedValue(detail),
  };
  const view = render(<ImportReports client={client as unknown as ApiClient} jurisdictionId="j1" />);
  const table = await view.findByRole("table", { name: "Import reports" });
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows.map((row) => within(row).getAllByRole("cell").slice(3).map((cell) => cell.textContent))).toEqual([
    ["3", "2", "0", "0", "1", "Waiting for sign-off"],
    ["2", "1", "1", "0", "0", "Signed off by Admin"],
  ]);
  expect((await axe.run(view.container)).violations).toEqual([]);

  // The open button's name holds its visible text and says which import it is.
  fireEvent.click(within(table).getByRole("button", { name: /^WebEOC migration: Significant Events, run / }));
  await view.findByRole("heading", { name: "WebEOC migration: Significant Events" });
  expect(client.getImportReport).toHaveBeenCalledWith("r1");
  const mapping = view.getByRole("table", { name: "Fields and the columns that filled them" });
  expect(within(mapping).getAllByRole("row").map((row) => row.textContent)).toEqual(["FieldFile column", "SummarySummary", "Severitysev"]);
  fireEvent.change(view.getByLabelText("Show"), { target: { value: "refused" } });
  const outcomes = view.getByRole("table", { name: "Rows and their outcomes" });
  expect(within(outcomes).getAllByRole("row").map((row) => row.textContent)).toEqual([
    "RowItemOutcomeDetail", "3dataid 12RefusedSummary is required and this row leaves it empty",
  ]);
  expect((await axe.run(view.container)).violations).toEqual([]);

  fireEvent.change(view.getByLabelText("Sign-off note (optional)"), { target: { value: "  Checked against WebEOC.  " } });
  fireEvent.click(view.getByRole("button", { name: "Sign off this report" }));
  await view.findByText(/^Signed off by Admin, .*\. Note: Checked against WebEOC\.$/);
  expect(client.signOffImportReport).toHaveBeenCalledWith("r1", "Checked against WebEOC.");
  // The list reads again, so its sign-off column follows.
  await waitFor(() => expect(client.listImportReports).toHaveBeenCalledTimes(2));
  expect(view.queryByRole("button", { name: "Sign off this report" })).toBeNull();
});

it("says when nothing has been imported and shows a refused sign-off in the server's words", async () => {
  const client = {
    listImportReports: vi.fn().mockResolvedValue({ reports: [], nextCursor: null }),
  };
  const view = render(<ImportReports client={client as unknown as ApiClient} jurisdictionId="j1" />);
  await view.findByText("No import has written into this jurisdiction yet.");

  cleanup();
  const failing = {
    listImportReports: vi.fn().mockResolvedValue({ reports: [webeoc], nextCursor: "c2" }),
    getImportReport: vi.fn().mockResolvedValue(detail),
    signOffImportReport: vi.fn().mockRejectedValue(new Error("this report was signed off by Admin")),
  };
  const next = render(<ImportReports client={failing as unknown as ApiClient} jurisdictionId="j1" />);
  fireEvent.click(await next.findByRole("button", { name: /^WebEOC migration: / }));
  fireEvent.click(await next.findByRole("button", { name: "Sign off this report" }));
  expect((await next.findByRole("alert")).textContent).toBe("this report was signed off by Admin");
  expect(failing.signOffImportReport).toHaveBeenCalledWith("r1", "");
  fireEvent.click(next.getByRole("button", { name: "Load more reports" }));
  await waitFor(() => expect(failing.listImportReports).toHaveBeenLastCalledWith("j1", { cursor: "c2" }));
});
