// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { FormReview } from "../form-gallery.js";

afterEach(cleanup);

async function violations(container: Element) {
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  return result.violations;
}

describe("form and drawer accessibility", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`${theme} open form drawer has no axe violations`, async () => {
      const view = render(<FormReview initialTheme={theme} />);
      fireEvent.click(view.getByRole("button", { name: "New request" }));
      await waitFor(() => expect(view.queryByText("Loading saved draft…")).toBeNull());
      const found = await violations(view.container);
      const summary = found.map((item) => `${item.id}: ${item.nodes.length} node(s)`).join("; ");
      expect(found, summary).toHaveLength(0);
    }, 30000);
  }

  it("uses one modal drawer with labeled grouped fields and no positive tabindex", async () => {
    const view = render(<FormReview />);
    fireEvent.click(view.getByRole("button", { name: "New request" }));
    await waitFor(() => expect(view.queryByText("Loading saved draft…")).toBeNull());
    expect(view.getByRole("dialog", { name: "New resource request" })).not.toBeNull();
    expect(view.getByRole("group", { name: "Request" })).not.toBeNull();
    expect(view.getByRole("group", { name: "Coordination" })).not.toBeNull();
    for (const element of view.container.querySelectorAll<HTMLElement>("[tabindex]")) {
      expect(Number(element.getAttribute("tabindex"))).toBeLessThanOrEqual(0);
    }
  });
});
