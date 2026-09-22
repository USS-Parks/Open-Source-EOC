// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  CopFeatureInspector,
  EmptyLayerSearch,
  WorkspaceSection,
  type CopInspection,
} from "../workspace.js";

afterEach(cleanup);

const selection: CopInspection = {
  title: "County Hospital",
  kind: "Operational facility",
  source: "Facilities board",
  status: "unknown",
  facilityType: "Hospital",
  freshness: "Stale last-good data · 18m",
  coverage: "Coverage unknown",
  attribution: "NAPSG Foundation facility symbol; source record retained.",
  rows: [
    { label: "Owner", value: "Public Health" },
    { label: "Notes", value: "Status was not supplied." },
  ],
};

describe("P-COP workspace presentation", () => {
  it("keeps grouped layer controls searchable without hiding an empty result", () => {
    render(
      <>
        <WorkspaceSection title="Operational layers" icon="boards" defaultOpen>
          <label><input type="checkbox" defaultChecked />Road closures</label>
        </WorkspaceSection>
        <EmptyLayerSearch visible />
      </>,
    );

    expect(screen.getByText("Operational layers")).not.toBeNull();
    expect(screen.getByLabelText("Road closures")).not.toBeNull();
    expect(screen.getByRole("status").textContent).toContain("No map layers match");
    expect(document.querySelector('[data-icon="boards"]')).not.toBeNull();
  });

  it("shows source, freshness, coverage, type, and explicit unknown status together", () => {
    render(<CopFeatureInspector selection={selection} onClose={() => undefined} />);

    const inspector = screen.getByRole("complementary", { name: "Selected map feature" });
    expect(inspector.textContent).toContain("County Hospital");
    expect(inspector.textContent).toContain("Hospital");
    expect(inspector.textContent).toContain("Unknown");
    expect(inspector.textContent).toContain("Stale last-good data");
    expect(inspector.textContent).toContain("Coverage unknown");
    expect(inspector.textContent).toContain("Public Health");
    expect(inspector.textContent).toContain("NAPSG Foundation");
  });

  it("labels missing freshness and coverage as unknown instead of omitting them", () => {
    render(<CopFeatureInspector selection={{
      ...selection,
      freshness: undefined,
      coverage: undefined,
    }} onClose={() => undefined} />);

    expect(screen.getByText("Freshness unknown")).not.toBeNull();
    expect(screen.getByText("Coverage unknown")).not.toBeNull();
  });

  it("uses distinct close, source, time, and map symbols and offers a return action", () => {
    const onClose = vi.fn();
    render(<CopFeatureInspector selection={selection} onClose={onClose} />);

    const icons = new Set(
      Array.from(document.querySelectorAll<SVGElement>("svg[data-icon]"))
        .map((icon) => icon.dataset.icon),
    );
    for (const name of ["close", "source", "clock", "map"]) {
      expect(icons.has(name)).toBe(true);
    }
    fireEvent.click(screen.getByRole("button", { name: "Return to map" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
