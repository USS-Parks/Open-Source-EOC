// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { KitReview } from "../kit-gallery.js";

afterEach(cleanup);

async function violations(container: Element) {
  const results = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations;
}

describe("component gallery accessibility", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`${theme} review has no axe violations`, async () => {
      const { container } = render(<KitReview initialTheme={theme} />);
      const found = await violations(container);
      const summary = found.map((item) => `${item.id}: ${item.nodes.length} node(s)`).join("; ");
      expect(found, summary).toHaveLength(0);
    }, 30000);
  }

  it("uses document order or roving zero tabindex without positive overrides", () => {
    const { container } = render(<KitReview />);
    const focusables = container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]',
    );
    for (const element of focusables) {
      const tabIndex = element.getAttribute("tabindex");
      expect(tabIndex === null || Number(tabIndex) <= 0).toBe(true);
    }
    const tabs = [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.filter((tab) => tab.getAttribute("tabindex") === "0")).toHaveLength(1);
  });

  it("associates the selected tab and panel and labels icon-free actions", () => {
    const { container, getByRole } = render(<KitReview />);
    const selected = getByRole("tab", { name: "Condition cards" });
    const panelId = selected.getAttribute("aria-controls");
    expect(panelId).toBe("kit-review-lifelines-panel");
    expect(container.querySelector(`#${panelId}`)?.getAttribute("aria-labelledby")).toBe(selected.id);
    expect(getByRole("button", { name: "Create report" }).textContent).toBe("Create report");
    expect(getByRole("button", { name: "Create report" }).getAttribute("data-primary")).toBe("true");
  });

  it("renders explicit labels for every condition and missing-data state in the kit", () => {
    const { container } = render(<KitReview />);
    const states = [...container.querySelectorAll<HTMLElement>("[data-state]")];
    expect(states.some((element) => element.dataset.state === "normal")).toBe(true);
    expect(states.some((element) => element.dataset.state === "critical")).toBe(true);
    expect(states.some((element) => element.dataset.state === "unknown")).toBe(true);
    for (const state of states) expect(state.textContent?.trim().length).toBeGreaterThan(1);
  });
});
