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
  incidentId: "10000000-0000-4000-8000-000000000001",
  incidentName: "North Fork Flood",
  revision: 3,
  sourceTime: "2026-09-17T11:55:00Z",
  content: {
    period: "OP-1",
    composedAt: new Date("2026-09-17T12:00:00Z").toISOString(),
    lifelines: [
      { lifeline: "energy", status: "unstable", note: "substation down", at: null },
      { lifeline: "communications", status: "unknown", note: null, at: null },
    ],
    esfs: [{ framework: "federal", esf: "esf_5_information_planning",
      activation: "activated", capacity: "constrained", situation: "Planning cell active",
      assessedAt: "2026-09-17T11:50:00Z", conflict: false }],
    boards: [
      { key: "shelters", title: "Shelters", records: 2, byStatus: { normal: 1, closed: 1 } },
    ],
    significantEvents: [
      { occurredAt: "2026-09-17T09:00:00Z", summary: "Levee overtopping", severity: "critical" },
    ],
    rumorControl: [
      { rumor: "The dam has failed", status: "false", response: "The dam is intact and monitored." },
    ],
    talkingPoints: [{ topic: "Dam safety", point: "Monitoring continues around the clock.", recordedAt: "2026-09-17T11:52:00Z" }],
  },
};

afterEach(cleanup);

describe("the briefing view renders an archived sitrep", () => {
  it("shows the frozen assessment attribution and linked stabilization action", () => {
    const assessed: SitrepRow = { ...sitrep, content: { ...sitrep.content,
      lifelines: sitrep.content.lifelines.map((line) => line.lifeline === "energy" ? {
        ...line, note: "Substation offline", at: "2026-09-21T10:00:00Z",
        assessment: { id: "assessment-1", person: "Utility operator", position: "Energy liaison",
          organization: "County utilities", recordedAt: "2026-09-21T10:01:00Z",
          payload: { stabilizationOutlook: "Restore critical facilities first",
            actions: [{ title: "Stage backup generator", status: "in_progress", dueAt: "2026-09-21T14:00:00Z" }] } },
      } : line),
    } };
    render(<Theme name="light"><BriefingView sitrep={assessed} /></Theme>);
    const energy = screen.getByTestId("lifeline-energy");
    expect(energy.textContent).toContain("Substation offline");
    expect(energy.textContent).toContain("Utility operator (Energy liaison)");
    expect(energy.textContent).toContain("County utilities");
    expect(energy.textContent).toContain("Stage backup generator");
    expect(energy.textContent).toContain("estimated");
  });

  it("shows lifeline conditions, board status, and significant events for an executive read", () => {
    render(
      <Theme name="light">
        <BriefingView sitrep={sitrep} />
      </Theme>,
    );
    expect(screen.getByText("Situation Report")).toBeTruthy();
    expect(screen.getByText(/Operational period OP-1/)).toBeTruthy();
    const briefing = screen.getByRole("article", { name: "Situation report: OP-1" });
    expect(briefing.textContent).toContain("North Fork Flood");
    expect(briefing.textContent).toContain("Revision 3");
    const energy = screen.getByTestId("lifeline-energy");
    expect(energy.textContent).toContain("unstable");
    expect(screen.getByText(/2 records/)).toBeTruthy();
    expect(screen.getByText(/1 normal, 1 closed/)).toBeTruthy();
    expect(screen.getByText(/Levee overtopping/)).toBeTruthy();
    expect(screen.getByText("Planning cell active")).toBeTruthy();
    expect(screen.getByText("Monitoring continues around the clock.")).toBeTruthy();
    // JIC rumor-control entries surface on the briefing view (VEOC-33A).
    const rumor = screen.getByTestId("rumor-0");
    expect(rumor.textContent).toContain("The dam has failed");
    expect(rumor.textContent).toContain("The dam is intact");
  });
});
