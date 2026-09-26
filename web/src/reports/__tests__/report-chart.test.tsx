// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FieldDef } from "@openeoc/shared";
import type { ApiClient, ReportDefinition, ReportResult } from "../../app/api/client.js";
import { ReportsSurface } from "../ReportsSurface.js";

afterEach(cleanup);

const boardId = "40000000-0000-4000-8000-000000000004";
const fields: FieldDef[] = [
  { key: "item", label: "Item", type: "text", required: true, read: "any", write: "member" },
  { key: "priority", label: "Priority", type: "enum", values: ["routine", "urgent"], required: false, read: "any", write: "member" },
  { key: "reported_at", label: "Reported at", type: "datetime", required: false, read: "any", write: "member" },
  { key: "location", label: "Location", type: "geometry", required: false, read: "any", write: "member" },
];

function result(definition: ReportDefinition): ReportResult {
  return {
    board: { id: boardId, title: "Supply log" }, incidentId: null, generatedAt: "2026-09-25T12:00:00.000Z",
    columns: [{ key: "item", label: "Item", type: "text" }], groupBy: [], totals: [], omitted: [],
    rows: [{ item: "Sandbags" }, { item: "Water" }, { item: "Cots" }], groups: [], total: { count: 3, totals: {} },
    chart: definition.chart ? {
      kind: "chart", key: "chart", title: "Records by Priority", display: definition.chart.display,
      groups: [{ value: "Routine", count: 2 }, { value: "Urgent", count: 1 }],
    } : null,
  };
}

function client() {
  return {
    listReports: vi.fn().mockResolvedValue({ reports: [], nextCursor: null }),
    getBoard: vi.fn().mockResolvedValue({
      id: boardId, title: "Supply log", templateKey: "supply_log", templateVersion: 1, role: "admin", canContribute: true, fields, views: [],
    }),
    previewReport: vi.fn((_jurisdiction: string, input: { definition: ReportDefinition }) => Promise.resolve(result(input.definition))),
  };
}

const lastDefinition = (api: ReturnType<typeof client>) => api.previewReport.mock.calls.at(-1)![1].definition;

describe("a chart in the report builder", () => {
  it("adds a chart to the definition and draws the preview's chart with the dashboards' chart", async () => {
    const api = client();
    const view = render(
      <ReportsSurface client={api as unknown as ApiClient} jurisdictionId="j1" canBuild incidentId={null} incidentName={null}
        incidentBoardIds={new Set()} boards={[{ id: boardId, title: "Supply log", templateKey: "supply_log", templateVersion: 1, hasGeometry: true }]} />,
    );
    fireEvent.click(await view.findByRole("button", { name: "New report" }));
    const builder = view.getByRole("region", { name: "New report" });
    const chart = within(builder).getByRole("group", { name: "Chart" });
    await waitFor(() => expect((within(chart).getByLabelText("Chart") as HTMLSelectElement).disabled).toBe(false));
    await waitFor(() => expect(api.previewReport).toHaveBeenCalled());
    expect(lastDefinition(api).chart).toBeNull();

    fireEvent.change(within(chart).getByLabelText("Chart"), { target: { value: "bar" } });
    // A geometry field is not offered.
    expect([...(within(chart).getByLabelText("Count records by") as HTMLSelectElement).options].map((o) => o.value))
      .toEqual(["item", "priority", "reported_at"]);
    fireEvent.change(within(chart).getByLabelText("Count records by"), { target: { value: "priority" } });
    await waitFor(() => expect(lastDefinition(api).chart).toEqual({ display: "bar", field: "priority", interval: null, timeZone: "UTC" }));
    const drawn = await within(builder).findByRole("article", { name: "Records by Priority" });
    expect(within(drawn).getByRole("img", { name: "Routine: 2" })).toBeTruthy();
    expect(within(drawn).getByRole("img", { name: "Urgent: 1" })).toBeTruthy();
    expect((await axe.run(view.container)).violations).toEqual([]);

    // Over time the chart counts per interval in a time zone, and only as bars.
    fireEvent.change(within(chart).getByLabelText("Count records by"), { target: { value: "reported_at" } });
    expect([...(within(chart).getByLabelText("Chart") as HTMLSelectElement).options].map((o) => o.value)).toEqual(["", "bar"]);
    fireEvent.change(within(chart).getByLabelText("Count per"), { target: { value: "hour" } });
    fireEvent.change(within(chart).getByLabelText("Chart time zone"), { target: { value: "America/Los_Angeles" } });
    await waitFor(() => expect(lastDefinition(api).chart)
      .toEqual({ display: "bar", field: "reported_at", interval: "hour", timeZone: "America/Los_Angeles" }));
    expect((await axe.run(view.container)).violations).toEqual([]);

    fireEvent.change(within(chart).getByLabelText("Chart"), { target: { value: "" } });
    await waitFor(() => expect(lastDefinition(api).chart).toBeNull());
    expect(within(builder).queryByRole("article", { name: "Records by Priority" })).toBeNull();
  });
});
