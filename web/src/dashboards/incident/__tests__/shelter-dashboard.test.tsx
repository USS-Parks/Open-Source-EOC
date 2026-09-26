// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STANDARD_TEMPLATES, type IncidentAreaRevision, type ViewRecord } from "@openeoc/shared";
import { ApiError, type BoardRecordChange } from "../../../app/api/client.js";
import { Theme } from "../../../design/components.js";
import { ShelterDashboard } from "../ShelterDashboard.js";
import {
  featureChart,
  featureFields,
  occupancyHistory,
  occupancyTotals,
  shelterOf,
  stateTiles,
  valuesAt,
} from "../shelters.js";

const template = STANDARD_TEMPLATES.filter((candidate) => candidate.key === "shelters").at(-1)!;
const BOARD = "board-1";
const INCIDENT = "incident-1";
const T = (hour: number) => new Date(Date.UTC(2026, 8, 26, hour)).toISOString();

const records: ViewRecord[] = [
  { id: "arcata", name: "Arcata Community Center", status: "normal", capacity: 240, occupancy: 187, pets_accepted: true, planned: false, createdAt: T(6) },
  { id: "eureka", name: "Eureka Municipal Auditorium", status: "compromised", capacity: 180, occupancy: 190, pets_accepted: false, planned: false, createdAt: T(6) },
  { id: "fortuna", name: "Fortuna Veterans Hall", status: "closed", capacity: 120, occupancy: 0, planned: false, createdAt: T(6) },
  { id: "trinidad", name: "Trinidad School", status: "normal", capacity: 80, occupancy: 0, pets_accepted: true, planned: true, createdAt: T(6) },
  // Seeded without history: its current values stand from its creation.
  { id: "loleta", name: "Loleta Community Center", status: "normal", capacity: 70, occupancy: 12, createdAt: T(13) },
];

const change = (seq: number, hour: number, changes: Record<string, unknown>): BoardRecordChange => ({
  seq, id: `e${seq}`, at: T(hour), category: seq === 1 ? "board.record.created" : "board.record.updated", corrects: null,
  actor: { personId: "p", displayName: "L. Moreno", positionId: null, positionTitle: null },
  changes: Object.entries(changes).map(([field, after]) => ({ field, before: null, after })),
});

const histories: Record<string, BoardRecordChange[] | null> = {
  arcata: [change(1, 6, { name: "Arcata Community Center", status: "normal", capacity: 240, occupancy: 150 }), change(2, 11, { occupancy: 187 })],
  eureka: [change(1, 6, { name: "Eureka Municipal Auditorium", status: "normal", capacity: 180, occupancy: 41 }), change(2, 13, { status: "compromised", occupancy: 190 })],
  fortuna: [change(1, 6, { status: "normal", capacity: 120, occupancy: 19 }), change(2, 9, { status: "closed", occupancy: 0 })],
  trinidad: [change(1, 6, { status: "normal", capacity: 80, occupancy: 0, planned: true })],
  loleta: null,
};

const period = (revision: number, label: string, startsAt: string, endsAt: string): IncidentAreaRevision => ({
  incidentId: INCIDENT, revision, geometry: null, operationalPeriod: { label, startsAt, endsAt }, reason: label,
  createdAt: startsAt, createdBy: null, positionId: null, createdByName: null, positionTitle: null,
});
const revisions = [period(1, "OP 01", T(0), T(5)), period(2, "OP 02", T(5), T(12)), period(3, "OP 02", T(5), T(12)), period(4, "OP 03", T(12), T(24))];

afterEach(cleanup);

describe("shelter counts", () => {
  const shelters = records.map((record) => shelterOf(record, featureFields(template.fields)));

  it("counts shelters by status, a planned site apart, in the shared shelter status colors", () => {
    expect(stateTiles(shelters).map((tile) => [tile.label, tile.value, tile.color]))
      .toEqual([["Open", 2, "var(--eoc-shelter-open)"], ["Compromised", 1, "var(--eoc-shelter-alert)"],
        ["Evacuating", 0, "var(--eoc-shelter-closed)"], ["Closed", 1, "var(--eoc-shelter-closed)"], ["Planned", 1, "var(--eoc-shelter-planned)"]]);
  });

  it("adds occupancy and capacity over operating shelters only", () => {
    expect(occupancyTotals(shelters)).toEqual({ occupancy: 389, capacity: 490, open: 101 });
    expect(featureChart(shelters, "pets_accepted").map((datum) => [datum.key, datum.value])).toEqual([["yes", 1], ["no", 1], ["blank", 1]]);
  });

  it("replays history to a moment, and stands a record with none from its creation", () => {
    expect(valuesAt(histories["arcata"]!, records[0]!, Date.parse(T(10)))).toMatchObject({ occupancy: 150 });
    expect(valuesAt(histories["arcata"]!, records[0]!, Date.parse(T(5)))).toBeNull();
    expect(valuesAt(null, records[4]!, Date.parse(T(12)))).toBeNull();
    expect(valuesAt(null, records[4]!, Date.parse(T(14)))).toBe(records[4]);
  });

  it("totals operating occupancy at the end of each period that has begun", () => {
    const history = occupancyHistory(revisions, records.map((record) => ({ record, history: histories[record.id]! })), Date.parse(T(15)));
    // OP 01 ends before any shelter opened; OP 02 ends with Fortuna closed; OP 03 is under way, Loleta open.
    expect(history).toEqual([
      { key: "period-0", label: "OP 01", value: 0 },
      { key: "period-1", label: "OP 02", value: 187 + 41 },
      { key: "period-2", label: "OP 03 (now)", value: 187 + 190 + 12 },
    ]);
    const later = occupancyHistory(revisions, records.map((record) => ({ record, history: histories[record.id]! })), Date.parse("2026-09-27T06:00:00Z"));
    expect(later.map((point) => point.label)).toEqual(["OP 01", "OP 02", "OP 03", "Now"]);
  });
});

function client() {
  return {
    boardViewPage: vi.fn().mockResolvedValue({ view: "all", columns: [], records, nextCursor: null }),
    boardRecordHistory: vi.fn((_board: string, recordId: string) => histories[recordId]
      ? Promise.resolve({ entries: histories[recordId], nextCursor: null })
      : Promise.reject(new ApiError(404, "record not found"))),
    incidentAreaHistory: vi.fn().mockResolvedValue(revisions),
  };
}

describe("shelter dashboard", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`draws status, occupancy, pets and history, and filters its list (${theme})`, async () => {
      const api = client();
      const onOpenRecord = vi.fn();
      const { container } = render(<Theme name={theme}>
        <ShelterDashboard client={api} boardId={BOARD} incidentId={INCIDENT} fields={template.fields} views={template.views}
          onOpenRecord={onOpenRecord} now={Date.parse(T(15))} />
      </Theme>);
      await screen.findByRole("list", { name: "Shelters by status" });
      expect(api.boardViewPage).toHaveBeenCalledWith(BOARD, "all", { incidentId: INCIDENT }, { limit: 500 });
      const occupancy = screen.getByRole("article", { name: "Occupancy against capacity" });
      expect(within(occupancy).getByRole("progressbar").getAttribute("aria-valuetext")).toBe("389 of 490, 79%");
      const history = screen.getByRole("article", { name: "Occupancy by operational period" });
      await within(history).findByRole("img", { name: "OP 03 (now): 389" });
      expect(screen.getByText(/Accessibility is not recorded on this board/)).toBeTruthy();

      const list = () => screen.getByRole("region", { name: /\d+ shelters?$/ });
      expect(within(list()).getAllByRole("listitem")).toHaveLength(5);
      fireEvent.click(screen.getByRole("button", { name: "1 Compromised" }));
      expect(within(list()).getAllByRole("listitem")).toHaveLength(1);
      expect(within(list()).getByText("190 of 180, over capacity")).toBeTruthy();
      fireEvent.click(within(screen.getByRole("article", { name: "Pets accepted" })).getByRole("button", { name: "Yes 1 (34%)" }));
      expect(within(list()).getAllByRole("listitem")).toHaveLength(1);
      fireEvent.click(within(list()).getByRole("button", { name: "Arcata Community Center" }));
      expect(onOpenRecord).toHaveBeenCalledWith("arcata");
      const results = await axe.run(container, { rules: { region: { enabled: false } } });
      expect(results.violations).toEqual([]);
    });
  }

  it("says so when there is no incident to follow and no shelter yet", async () => {
    const api = client();
    api.boardViewPage.mockResolvedValue({ view: "all", columns: [], records: [], nextCursor: null });
    render(<ShelterDashboard client={api} boardId={BOARD} incidentId={null} fields={template.fields} views={template.views} onOpenRecord={vi.fn()} />);
    await screen.findByText("No shelters are recorded on this board yet.");
    expect(screen.getByText(/Occupancy history follows an incident's operational periods/)).toBeTruthy();
    expect(api.incidentAreaHistory).not.toHaveBeenCalled();
  });
});
