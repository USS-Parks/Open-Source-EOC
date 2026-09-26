// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ApiClient, WebeocImportReport } from "../../app/api/client.js";
import { WebeocImport } from "../WebeocImport.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const board = {
  id: "b1", title: "Significant Events", templateKey: "significant_events", templateVersion: 1, role: "admin", canContribute: true,
  fields: [
    { key: "summary", label: "Summary", type: "text", required: true, read: "any", write: "member" },
    { key: "severity", label: "Severity", type: "enum", values: ["normal", "critical"], required: true, read: "any", write: "member" },
  ],
  views: [],
};

function report(dryRun: boolean, mapping: Readonly<Record<string, string>>): WebeocImportReport {
  return {
    dryRun, columns: ["dataid", "Summary", "sev"], mapping, provenance: ["dataid"], dropped: ["sev"],
    rows: 2, valid: 1, created: dryRun ? 0 : 1, skipped: 0, rejected: 1,
    outcomes: [
      { row: 2, dataid: "11", outcome: "create", reasons: [], ...(dryRun ? {} : { recordId: "r1" }) },
      { row: 3, dataid: "12", outcome: "reject", reasons: ["Severity \"High\" is not one of its options: normal, critical"] },
    ],
    rejectionCsv: "Rejected row,Rejection reason,dataid,Summary,sev\r\n3,bad,12,Power out,High\r\n",
  };
}

function setup() {
  const client = {
    listBoards: vi.fn().mockResolvedValue([{ id: "b1", title: "Significant Events", templateKey: "significant_events", templateVersion: 1, hasGeometry: false }]),
    getBoard: vi.fn().mockResolvedValue(board),
    webeocMapping: vi.fn().mockResolvedValue({ mapping: { summary: "Summary" }, timeZone: "America/Chicago", updatedAt: "2026-09-23T10:00:00Z" }),
    saveWebeocMapping: vi.fn().mockResolvedValue({ mapping: {}, timeZone: "America/Chicago", updatedAt: "2026-09-23T11:00:00Z" }),
    importWebeocRecords: vi.fn((_board: string, _file: Blob, options: { dryRun: boolean; mapping?: Record<string, string> }) =>
      Promise.resolve(report(options.dryRun, options.mapping ?? { summary: "Summary" }))),
  };
  render(<WebeocImport client={client as unknown as ApiClient} jurisdictionId="j1" />);
  return client;
}

it("checks a WebEOC export with the saved mapping, imports the valid rows and downloads the rejection report", async () => {
  const client = setup();
  await screen.findByRole("option", { name: "Significant Events" });
  fireEvent.change(screen.getByLabelText("Target board"), { target: { value: "b1" } });
  const input = await screen.findByLabelText("WebEOC export (CSV or Excel)");
  // The saved zone replaces the browser's zone once the board has loaded.
  await waitFor(() => expect((screen.getByLabelText("WebEOC server time zone") as HTMLSelectElement).value).toBe("America/Chicago"));
  const file = new File(["dataid,Summary,sev\r\n11,Levee seep,normal\r\n12,Power out,High\r\n"], "events.csv", { type: "text/csv" });
  fireEvent.change(input, { target: { files: [file] } });

  await screen.findByRole("heading", { name: "Check result" });
  expect(client.importWebeocRecords).toHaveBeenLastCalledWith("b1", file, { dryRun: true, timeZone: "America/Chicago", mapping: { summary: "Summary" } });
  const rows = within(screen.getByRole("table", { name: "Row outcomes" })).getAllByRole("row");
  expect(rows.map((row) => row.textContent)).toEqual([
    "RowWebEOC dataidOutcomeReason", "211Will be created", "312RejectedSeverity \"High\" is not one of its options: normal, critical",
  ]);
  screen.getByText(/Kept as provenance on each record's creation entry in the audit trail: dataid\./);
  screen.getByText(/Not imported: sev\./);

  // A changed column needs a new check before Import is offered.
  fireEvent.change(screen.getByLabelText("Column for Severity"), { target: { value: "sev" } });
  screen.getByText("The mapping or time zone changed; check the file again before importing.");
  expect(screen.getByRole("button", { name: "Import" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Check file" }));
  const importButton = await screen.findByRole("button", { name: "Import 1 record" });
  expect(client.importWebeocRecords).toHaveBeenLastCalledWith("b1", file,
    { dryRun: true, timeZone: "America/Chicago", mapping: { summary: "Summary", severity: "sev" } });

  fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));
  await screen.findByText("Mapping saved for Significant Events.");
  expect(client.saveWebeocMapping).toHaveBeenCalledWith("b1", { mapping: { summary: "Summary", severity: "sev" }, timeZone: "America/Chicago" });

  fireEvent.click(importButton);
  await screen.findByText("Imported 1 record. 1 row rejected, 0 already imported. The import report waits for sign-off below.");
  expect(client.importWebeocRecords).toHaveBeenLastCalledWith("b1", file,
    { dryRun: false, timeZone: "America/Chicago", mapping: { summary: "Summary", severity: "sev" } });
  screen.getByRole("heading", { name: "Import result" });
  screen.getByRole("cell", { name: "Created" });

  const created = vi.fn((_blob: Blob) => "blob:rejections");
  Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  fireEvent.click(screen.getByRole("button", { name: "Download rejection report" }));
  await waitFor(() => expect(created).toHaveBeenCalled());
  expect(await created.mock.calls[0]![0].text()).toBe(report(false, {}).rejectionCsv);
});
