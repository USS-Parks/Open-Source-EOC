// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SitrepRow } from "@openeoc/shared";
import { Theme } from "../../design/components.js";
import { BriefingView } from "../BriefingView.js";

const sitrep: SitrepRow = {
  id: "s1",
  period: "OP-1",
  composedAt: new Date("2026-09-17T12:00:00Z").toISOString(),
  composedBy: "Duty Officer",
  content: {
    period: "OP-1",
    composedAt: new Date("2026-09-17T12:00:00Z").toISOString(),
    lifelines: [
      { lifeline: "energy", status: "unstable", note: "substation down", at: null },
      { lifeline: "communications", status: "unknown", note: null, at: null },
    ],
    boards: [
      { key: "shelters", title: "Shelters", records: 2, byStatus: { normal: 1, closed: 1 } },
    ],
    significantEvents: [
      { occurredAt: "2026-09-17T09:00:00Z", summary: "Levee overtopping", severity: "critical" },
    ],
    rumorControl: [
      { rumor: "The dam has failed", status: "false", response: "The dam is intact and monitored." },
    ],
  },
};

afterEach(cleanup);

describe("the briefing view renders an archived sitrep", () => {
  it("shows lifeline conditions, board status, and significant events for an executive read", () => {
    render(
      <Theme name="light">
        <BriefingView sitrep={sitrep} />
      </Theme>,
    );
    expect(screen.getByText("Situation Report")).toBeTruthy();
    expect(screen.getByText(/Operational period OP-1/)).toBeTruthy();
    const energy = screen.getByTestId("lifeline-energy");
    expect(energy.textContent).toContain("unstable");
    expect(screen.getByText(/2 records/)).toBeTruthy();
    expect(screen.getByText(/1 normal, 1 closed/)).toBeTruthy();
    expect(screen.getByText(/Levee overtopping/)).toBeTruthy();
    // JIC rumor-control entries surface on the briefing view (VEOC-33A).
    const rumor = screen.getByTestId("rumor-0");
    expect(rumor.textContent).toContain("The dam has failed");
    expect(rumor.textContent).toContain("The dam is intact");
  });
});
