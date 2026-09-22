// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import type { SitrepRow } from "@openeoc/shared";
import { Theme, Button, TextField, EnumSelect } from "../components.js";
import { BriefingView } from "../../sitreps/BriefingView.js";

/**
 * Operational-surface accessibility and stress-UX (VEOC-39). Axe covers a
 * real operational screen (the briefing view a PIO reads), not only the
 * component gallery; and interactive controls meet a glove/touchscreen
 * target so field users in PPE can operate them. Contrast for both themes
 * (including night-shift dark mode) is proven in contrast.test.ts.
 */

afterEach(cleanup);

const sitrep: SitrepRow = {
  id: "s1",
  period: "OP-1",
  composedAt: new Date("2026-09-17T12:00:00Z").toISOString(),
  composedBy: "Duty Officer",
  content: {
    period: "OP-1",
    composedAt: new Date("2026-09-17T12:00:00Z").toISOString(),
    lifelines: [{ lifeline: "energy", status: "unstable", note: "substation down", at: null }],
    boards: [{ key: "shelters", title: "Shelters", records: 2, byStatus: { normal: 1, closed: 1 } }],
    significantEvents: [{ occurredAt: "2026-09-17T09:00:00Z", summary: "Levee overtopping", severity: "critical" }],
    rumorControl: [{ rumor: "The dam has failed", status: "false", response: "The dam is intact." }],
  },
};

async function violations(container: Element) {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  return results.violations;
}

describe("operational surface accessibility", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`the briefing view has no axe violations in the ${theme} theme`, async () => {
      const { container } = render(
        <Theme name={theme}>
          <BriefingView sitrep={sitrep} />
        </Theme>,
      );
      const v = await violations(container);
      expect(v, v.map((x) => x.id).join("; ")).toHaveLength(0);
    }, 30000);
  }

  it("the briefing view uses one page heading and named sections for screen readers", () => {
    const { container } = render(
      <Theme name="light">
        <BriefingView sitrep={sitrep} />
      </Theme>,
    );
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")?.textContent).toBe("Situation Report");
    const sections = container.querySelectorAll("section[aria-labelledby]");
    expect(sections.length).toBeGreaterThanOrEqual(3);
    for (const section of sections) {
      const heading = document.getElementById(section.getAttribute("aria-labelledby")!);
      expect(heading?.tagName).toBe("H2");
      expect(section.contains(heading)).toBe(true);
    }
  });
});

describe("glove and touchscreen targets", () => {
  it("interactive controls meet a 44px minimum touch target", () => {
    const { getByRole, getByLabelText } = render(
      <Theme name="light">
        <Button onClick={() => undefined}>Acknowledge</Button>
        <TextField label="Point of contact" value="" onChange={() => undefined} />
        <EnumSelect label="Status" values={["green", "red"]} value="green" onChange={() => undefined} />
      </Theme>,
    );
    expect(getByRole("button").style.minHeight).toBe("44px");
    expect(getByLabelText("Point of contact").style.minHeight).toBe("44px");
    expect(getByLabelText("Status").style.minHeight).toBe("44px");
  });
});
