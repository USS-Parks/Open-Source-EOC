// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, expect, it, vi } from "vitest";
import type { ApiClient, PeopleImportReport } from "../../app/api/client.js";
import { PeopleImport } from "../PeopleImport.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function report(dryRun: boolean): PeopleImportReport {
  return {
    dryRun, columns: ["email", "name", "role", "positions", "phone"], dropped: ["phone"],
    rows: 3, created: 1, updated: 1, skipped: 0, refused: 1,
    outcomes: [
      { row: 2, email: "ana.reyes@example.org", outcome: "created", detail: "new account as member; assigned Planning Section Chief" },
      { row: 3, email: "liaison@county.example.org", outcome: "updated", detail: "existing account added as viewer" },
      { row: 4, email: "not-an-email", outcome: "refused", detail: 'email "not-an-email" is not an email address' },
    ],
    ...(dryRun ? {} : { reportId: "r9" }),
  };
}

it("checks a people file, asks for the first password, imports it and downloads the template", async () => {
  const client = {
    importPeople: vi.fn((_j: string, _file: Blob, options: { dryRun: boolean }) => Promise.resolve(report(options.dryRun))),
    peopleImportTemplate: vi.fn().mockResolvedValue(new Blob(["email,name,role,positions\r\n"], { type: "text/csv" })),
  };
  const onImported = vi.fn();
  const view = render(<PeopleImport client={client as unknown as ApiClient} jurisdictionId="j1" onImported={onImported} />);
  const file = new File(["email,name,role\r\n"], "staff.csv", { type: "text/csv" });
  fireEvent.change(view.getByLabelText("People file (CSV or Excel)"), { target: { files: [file] } });

  await view.findByRole("heading", { name: "Check result" });
  expect(client.importPeople).toHaveBeenLastCalledWith("j1", file, { dryRun: true });
  view.getByText("3 rows read: 1 new account, 1 to update, 0 skipped, 1 refused.");
  view.getByText("Not read: phone.");
  const table = view.getByRole("table", { name: "People rows and their outcomes" });
  expect(within(table).getAllByRole("row").map((row) => row.textContent)).toEqual([
    "RowEmailOutcomeDetail",
    "2ana.reyes@example.orgWill be creatednew account as member; assigned Planning Section Chief",
    "3liaison@county.example.orgWill be updatedexisting account added as viewer",
    "4not-an-emailRefusedemail \"not-an-email\" is not an email address",
  ]);
  expect((await axe.run(view.container)).violations).toEqual([]);

  // A new account needs the first password before anything is sent.
  fireEvent.click(view.getByRole("button", { name: "Import 2 people" }));
  expect((await view.findByRole("alert")).textContent).toBe("Enter a first password of at least 12 characters for the new accounts.");
  expect(client.importPeople).toHaveBeenCalledTimes(1);
  fireEvent.change(view.getByLabelText("First password for the new accounts"), { target: { value: "river-bend-first-2026" } });
  fireEvent.click(view.getByRole("button", { name: "Import 2 people" }));
  await view.findByText("Imported 1 new account; 1 updated, 0 skipped, 1 refused. The import report waits for sign-off on the Records tab.");
  expect(client.importPeople).toHaveBeenLastCalledWith("j1", file, { dryRun: false, password: "river-bend-first-2026" });
  expect(onImported).toHaveBeenCalledTimes(1);
  view.getByRole("heading", { name: "Import result" });
  expect(view.queryByLabelText("First password for the new accounts")).toBeNull();
  expect(within(view.getByRole("table", { name: "People rows and their outcomes" })).getAllByRole("cell", { name: "Created" })).toHaveLength(1);

  const created = vi.fn((_blob: Blob) => "blob:template");
  Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  fireEvent.click(view.getByRole("button", { name: "Download template" }));
  await waitFor(() => expect(created).toHaveBeenCalled());
  expect(client.peopleImportTemplate).toHaveBeenCalledWith("j1");
  expect(await created.mock.calls[0]![0].text()).toBe("email,name,role,positions\r\n");
});

it("shows a file the server refuses in the server's words and offers no import", async () => {
  const client = { importPeople: vi.fn().mockRejectedValue(new Error("the file needs email, name and role columns; it has no email column")) };
  const view = render(<PeopleImport client={client as unknown as ApiClient} jurisdictionId="j1" onImported={vi.fn()} />);
  fireEvent.change(view.getByLabelText("People file (CSV or Excel)"), { target: { files: [new File(["name\r\n"], "bad.csv")] } });
  expect((await view.findByRole("alert")).textContent).toBe("the file needs email, name and role columns; it has no email column");
  expect(view.queryByRole("button", { name: /^Import/ })).toBeNull();
});
