// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DashboardTemplate } from "@openeoc/shared";
import type { ApiClient } from "../../app/api/client.js";
import { DashboardDefinitions } from "../DashboardDefinitions.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const template = { key: "ops_overview", version: 3, title: "Operations overview", widgets: [] } as unknown as DashboardTemplate;
const dashboards = [{ id: "d1", title: "County operations", templateKey: "ops_overview" }];

it("creates a dashboard from a template key, admin only, and reports it", async () => {
  const onCreated = vi.fn();
  const client = { createDashboard: vi.fn().mockResolvedValue({ id: "d2" }) };
  const view = render(<DashboardDefinitions client={client as unknown as ApiClient} jurisdictionId="j1" isAdmin
    dashboards={dashboards} definitions={[]} onCreated={onCreated} />);
  expect(screen.getByText("Templates in use: ops_overview.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Dashboard template key"), { target: { value: " ops_overview " } });
  fireEvent.change(screen.getByLabelText("Template version (empty for the latest)"), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: "Create dashboard" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Enter a whole version number, or leave it empty for the latest.");
  fireEvent.change(screen.getByLabelText("Template version (empty for the latest)"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Dashboard title (empty uses the template's)"), { target: { value: "Night shift" } });
  fireEvent.click(screen.getByRole("button", { name: "Create dashboard" }));
  await screen.findByText("Dashboard created from template ops_overview.");
  expect(client.createDashboard).toHaveBeenCalledWith("j1", { templateKey: "ops_overview", version: 2, title: "Night shift" });
  expect(onCreated).toHaveBeenCalledOnce();
  view.unmount();
  render(<DashboardDefinitions client={client as unknown as ApiClient} jurisdictionId="j1" isAdmin={false}
    dashboards={dashboards} definitions={[]} />);
  expect(screen.queryByRole("button", { name: "Create dashboard" })).toBeNull();
});

it("downloads a dashboard's template at the version its definition uses", async () => {
  const saved: string[] = [];
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:template"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { saved.push(this.download); });
  const client = { exportDashboardTemplate: vi.fn().mockResolvedValue(template) };
  render(<DashboardDefinitions client={client as unknown as ApiClient} jurisdictionId="j1" isAdmin={false}
    dashboards={dashboards} definitions={[{ id: "d1", title: "County operations", template }]} />);
  const row = screen.getByRole("listitem", { name: "County operations" });
  expect(within(row).getByText("Template ops_overview · version 3")).toBeTruthy();
  fireEvent.click(within(row).getByRole("button", { name: "Export template for County operations" }));
  await screen.findByText("Template ops_overview version 3 downloaded.");
  expect(client.exportDashboardTemplate).toHaveBeenCalledWith("ops_overview", 3);
  expect(saved).toEqual(["ops_overview-v3.json"]);
});
