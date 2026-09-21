// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { Gallery, TokenReview } from "../gallery.js";
import { fireEvent } from "@testing-library/react";

afterEach(cleanup);

async function runAxe(container: Element) {
  // color-contrast needs a real renderer; contrast is proven mathematically
  // in contrast.test.ts, so it is excluded here rather than trusted to jsdom.
  const results = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations;
}

describe("gallery accessibility", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`${theme} theme has no axe violations`, async () => {
      const { container } = render(<Gallery theme={theme} />);
      const violations = await runAxe(container);
      const summary = violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`).join("; ");
      expect(violations, summary).toHaveLength(0);
    }, 30000);
  }

  it("keyboard order follows document order with no tabindex overrides", () => {
    const { container } = render(<Gallery theme="light" />);
    const focusables = [
      ...container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]',
      ),
    ];
    // No positive tabindex anywhere: document order IS tab order.
    for (const el of focusables) {
      const ti = el.getAttribute("tabindex");
      expect(ti === null || Number(ti) <= 0, `positive tabindex on ${el.tagName}`).toBe(true);
    }
    // The sequence starts: skip link, then the form controls, then actions.
    expect(focusables[0]?.textContent).toBe("Skip to content");
    const kinds = focusables.slice(1, 6).map((el) => el.tagName);
    expect(kinds).toEqual(["INPUT", "SELECT", "BUTTON", "BUTTON", "BUTTON"]);
    // Focus is actually receivable where it matters.
    focusables[1]?.focus();
    expect(document.activeElement).toBe(focusables[1]);
  });

  it("labels are programmatically associated with their controls", () => {
    const { getByLabelText } = render(<Gallery theme="light" />);
    expect(getByLabelText("Point of contact").tagName).toBe("INPUT");
    expect(getByLabelText("Lifeline status").tagName).toBe("SELECT");
  });
});

describe("semantic token review accessibility", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`${theme} token review has no axe violations`, async () => {
      const { container, getByRole } = render(<TokenReview />);
      if (theme === "dark") fireEvent.click(getByRole("button", { name: "Use dark theme" }));
      expect(container.querySelector(".token-review")?.getAttribute("data-review-theme")).toBe(theme);
      const violations = await runAxe(container);
      const summary = violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`).join("; ");
      expect(violations, summary).toHaveLength(0);
    }, 30000);
  }

  it("keeps neutral zero separate from operational normal", () => {
    const { getByText } = render(<TokenReview />);
    expect(getByText("Zero").closest(".eoc-state")?.getAttribute("data-treatment")).toBe("numeric");
    expect(getByText("Normal").closest(".eoc-state")?.getAttribute("data-treatment")).toBe("solid");
  });
});
