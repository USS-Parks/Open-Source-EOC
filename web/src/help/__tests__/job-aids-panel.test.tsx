// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { HelpDialog } from "../../app/layout/ShellDialogs.js";
import { JOB_AIDS } from "../job-aids.js";

afterEach(cleanup);

const titles = JOB_AIDS.map((aid) => aid.title);

function openHelp(position: { key: string; title: string } | null) {
  const view = render(<HelpDialog open position={position} onClose={() => undefined} />);
  const help = view.getByRole("dialog", { name: "Help" });
  return { view, help, aids: within(help).getByRole("tablist", { name: "Job aids" }) };
}

describe("job aids in Help", () => {
  it("opens the acting position's aid first and lists every position's", async () => {
    const { view, help, aids } = openHelp({ key: "planning_section_chief", title: "Planning Section Chief" });
    const tabs = within(aids).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Planning Section Chief", ...titles.filter((t) => t !== "Planning Section Chief")]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(within(help).getByText("The job aid for your acting position, Planning Section Chief.")).not.toBeNull();
    const panel = within(help).getByRole("tabpanel", { name: "Job aid: Planning Section Chief" });
    expect(within(panel).getByRole("heading", { name: "Job Aid: Planning Section Chief" })).not.toBeNull();
    expect(within(panel).getByRole("heading", { name: "First 15 minutes" })).not.toBeNull();
    // The guides still load beside the aids.
    expect(await within(help).findByRole("heading", { name: "Operator Quickstart" })).not.toBeNull();
    expect((await axe.run(view.container)).violations).toEqual([]);

    fireEvent.click(within(aids).getByRole("tab", { name: "Field User" }));
    expect(within(aids).getByRole("tab", { name: "Field User" }).getAttribute("aria-selected")).toBe("true");
    const field = within(help).getByRole("tabpanel", { name: "Job aid: Field User" });
    expect(within(field).getByRole("heading", { name: "Working without a connection" })).not.toBeNull();
  });

  it("renders an aid's markdown as text, tables and lists, never as markup", () => {
    const { help } = openHelp({ key: "planning_section_chief", title: "Planning Section Chief" });
    const panel = within(help).getByRole("tabpanel", { name: "Job aid: Planning Section Chief" });
    expect(within(panel).getByRole("table")).not.toBeNull();
    expect(within(panel).getAllByRole("listitem").length).toBeGreaterThan(5);
    expect(panel.textContent).not.toContain("**");
    expect(panel.textContent).not.toContain("](");
    expect(panel.querySelectorAll("a, script, iframe, img").length).toBe(0);
  });

  it("gives a position without an aid of its own the nearest one, and says so", () => {
    const { help, aids } = openHelp({ key: "safety_officer", title: "Safety Officer" });
    expect(within(help).getByText("No job aid is written for Safety Officer; the nearest is Planning Section Chief.")).not.toBeNull();
    expect(within(aids).getAllByRole("tab")[0]!.getAttribute("aria-selected")).toBe("true");
    expect(within(help).getByRole("tabpanel", { name: "Job aid: Planning Section Chief" })).not.toBeNull();
  });

  it("finds a position made under its own short code by its title", () => {
    const { help } = openHelp({ key: "sitl", title: "Situation Unit Leader" });
    expect(within(help).getByRole("tabpanel", { name: "Job aid: Situation Unit" })).not.toBeNull();
  });

  it("lists every aid with none open when there is no acting position or no match", async () => {
    for (const position of [null, { key: "cultural_monitor", title: "Cultural Monitor" }]) {
      const { view, help, aids } = openHelp(position);
      expect(within(aids).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(titles);
      expect(within(aids).queryByRole("tab", { selected: true })).toBeNull();
      expect(within(help).queryByRole("tabpanel", { name: /^Job aid:/ })).toBeNull();
      expect(within(help).getByText(position
        ? "No job aid is written for Cultural Monitor. Choose the one nearest your work."
        : "No acting position is selected. Choose a job aid.")).not.toBeNull();
      await within(help).findByRole("heading", { name: "Operator Quickstart" });
      expect((await axe.run(view.container)).violations).toEqual([]);
      cleanup();
    }
  });
});
