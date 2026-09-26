// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DAMAGE_DEGREE_PALETTE, PA_CATEGORY_PALETTE } from "@openeoc/shared";
import { Theme } from "../../design/components.js";
import { DamageDashboard, damageCharts, damageRows, type DamageChart } from "../DamageDashboard.js";
import type { DamageReport, PaItem } from "../model.js";

const report = (id: string, degree: string, status: DamageReport["status"], structure = "single_family"): DamageReport => ({
  id, address: `${id} Main St`, structure_type: structure, degree, source: status === "approved" ? "official" : "public", status,
  estimated_loss: 10_000, insured: null, notes: null, reporter_contact: null, created_at: "2026-09-26T16:00:00.000Z", lon: null, lat: null,
});

const item = (id: string, category: string, status: PaItem["status"]): PaItem => ({
  id, incident_id: null, applicant: `Applicant ${id}`, category, site: null, description: "Work", estimated_cost_cents: 125_000,
  insured: null, percent_complete: 10, status, lon: null, lat: null, created_at: "2026-09-26T16:00:00.000Z",
  updated_at: "2026-09-26T16:00:00.000Z", force_account_at: null,
} as PaItem);

const reports = [
  report("r1", "destroyed", "approved"),
  report("r2", "major", "approved", "mobile_home"),
  report("r3", "major", "approved"),
  report("r4", "affected", "approved", "business"),
  report("r5", "minor", "submitted"),
  report("r6", "destroyed", "rejected"),
];
const items = [
  item("p1", "a_debris_removal", "submitted"),
  item("p2", "b_emergency_protective_measures", "reviewed"),
  item("p3", "a_debris_removal", "draft"),
];

afterEach(cleanup);

const CHARTS: readonly DamageChart[] = ["report", "degree", "structure", "category", "paStatus"];

describe("damage dashboard counts", () => {
  it("counts every category exactly as the list it filters holds", () => {
    const charts = damageCharts(reports, items);
    for (const chart of CHARTS) {
      for (const datum of charts[chart]) {
        const listed = damageRows(reports, items, { chart, key: datum.key });
        expect(listed.reports.length + listed.items.length, `${chart}:${datum.key}`).toBe(datum.value);
      }
    }
  });

  it("counts accepted reports by FEMA degree, worst first, and line items by category A to G", () => {
    const charts = damageCharts(reports, items);
    expect(charts.degree.map((datum) => [datum.label, datum.value]))
      .toEqual([["Destroyed", 1], ["Major damage", 2], ["Minor damage", 0], ["Affected", 1], ["Inaccessible", 0]]);
    expect(charts.report.map((datum) => datum.value)).toEqual([1, 4, 1, 3]);
    expect(charts.category.map((datum) => datum.label)[0]).toBe("A: Debris removal");
    expect(charts.category).toHaveLength(7);
    expect(charts.category[0]!.value).toBe(2);
    expect(damageRows(reports, items, null).reports.map((row) => row.id)).toEqual(["r1", "r2", "r3", "r4"]);
  });
});

describe("damage dashboard", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`filters its list from a tile, a slice and a bar (${theme})`, async () => {
      const client = {
        listDamageReports: vi.fn().mockResolvedValue({ assessments: reports, nextCursor: null }),
        listPaItems: vi.fn().mockResolvedValue({ items, nextCursor: null, totals: { byCategory: {}, totalCost: 0, items: 0 } }),
      };
      const { container } = render(<Theme name={theme}><DamageDashboard client={client} jurisdictionId="j1" revision={0} /></Theme>);
      await screen.findByRole("list", { name: "Reports and line items" });
      expect(client.listDamageReports).toHaveBeenCalledWith("j1", { limit: 500 });
      // Degree and category colors are the shared palette tables', in this theme.
      expect(document.head.innerHTML).toContain(`--eoc-degree-destroyed: ${DAMAGE_DEGREE_PALETTE.entries.destroyed[theme]};`);
      expect(document.head.innerHTML).toContain(`--eoc-pa-a-debris-removal: ${PA_CATEGORY_PALETTE.entries.a_debris_removal[theme]};`);
      expect(damageCharts(reports, items).degree.map((datum) => datum.color)[1]).toBe("var(--eoc-degree-major)");
      const list = () => screen.getByRole("region", { name: /\d+ (reports?|line items?)$/ });
      expect(within(list()).getAllByRole("listitem")).toHaveLength(4);
      fireEvent.click(screen.getByRole("button", { name: "1 In the intake queue" }));
      expect(within(list()).getByText("r5 Main St")).toBeTruthy();
      fireEvent.click(within(screen.getByRole("article", { name: "Counted structures by degree" })).getByRole("button", { name: "View Major damage" }));
      expect(within(list()).getAllByRole("listitem")).toHaveLength(2);
      fireEvent.click(within(screen.getByRole("article", { name: "Public Assistance line items by category" }))
        .getByRole("button", { name: "A: Debris removal: 2" }));
      expect(within(list()).getAllByRole("listitem")).toHaveLength(2);
      expect(within(list()).getByText(/Draft, not counted/)).toBeTruthy();
      expect(screen.getByText(/not a jurisdiction or area, so there is no count by area/)).toBeTruthy();
      const results = await axe.run(container, { rules: { region: { enabled: false } } });
      expect(results.violations).toEqual([]);
    });
  }

  it("reads the selected incident's records and marks those recorded with no incident", async () => {
    const own = { ...report("q1", "major", "approved"), incident_id: "i1" };
    const client = {
      listDamageReports: vi.fn().mockResolvedValue({ assessments: [own, report("u1", "minor", "approved")], nextCursor: null }),
      listPaItems: vi.fn().mockResolvedValue({ items: [], nextCursor: null, totals: { byCategory: {}, totalCost: 0, items: 0 } }),
    };
    render(<DamageDashboard client={client} jurisdictionId="j1" revision={0} incidentId="i1" />);
    await screen.findByRole("list", { name: "Reports and line items" });
    expect(client.listDamageReports).toHaveBeenCalledWith("j1", { limit: 500, incidentId: "i1" });
    expect(client.listPaItems).toHaveBeenCalledWith("j1", { limit: 500, incidentId: "i1" });
    const rows = within(screen.getByRole("region", { name: /\d+ reports?$/ })).getAllByRole("listitem");
    expect(rows.map((row) => /No incident/.test(row.textContent ?? ""))).toEqual([false, true]);
  });

  it("reads honestly with nothing reported", async () => {
    const client = {
      listDamageReports: vi.fn().mockResolvedValue({ assessments: [], nextCursor: null }),
      listPaItems: vi.fn().mockResolvedValue({ items: [], nextCursor: null, totals: { byCategory: {}, totalCost: 0, items: 0 } }),
    };
    render(<DamageDashboard client={client} jurisdictionId="j1" revision={0} />);
    await screen.findByText(/No report has been accepted yet/);
    expect(screen.getAllByText("No accepted reports yet")).toHaveLength(2);
    expect(screen.getAllByText("No Public Assistance line items yet")).toHaveLength(2);
  });
});
