// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WORK_STATUS_PALETTE, paletteCssVariables } from "@openeoc/shared";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Theme } from "../../components.js";
import { contrastRatio, themes, type ThemeName } from "../../tokens.js";
import {
  ChartCard,
  DashboardGrid,
  DonutChart,
  HBarChart,
  ProgressBar,
  StatusChips,
  StatusTiles,
  VBarChart,
  niceTicks,
  percentages,
  statusPalette,
} from "../index.js";

afterEach(cleanup);

const priority = [
  { key: "low", label: "Low", value: 55, color: statusPalette.complete },
  { key: "medium", label: "Medium", value: 20, color: statusPalette.inProgress },
  { key: "high", label: "High", value: 3, color: statusPalette.pastDue },
];

const THEMES: readonly ThemeName[] = ["light", "dark"];

describe("chart arithmetic", () => {
  it("rounds shares so they add up to exactly 100", () => {
    expect(percentages([55, 20, 3])).toEqual([70, 26, 4]);
    expect(percentages([1, 1, 1])).toEqual([34, 33, 33]);
    expect(percentages([6, 3, 3]).reduce((a, b) => a + b)).toBe(100);
    expect(percentages([0, 0])).toEqual([0, 0]);
    expect(percentages([-4, Number.NaN, 2])).toEqual([0, 0, 100]);
  });

  it("steps the y axis on 1, 2 and 5 from zero", () => {
    expect(niceTicks(59)).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(niceTicks(12)).toEqual([0, 2, 4, 6, 8, 10, 12]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(1)).toEqual([0, 1]);
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(0.8, false)).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
  });
});

describe("the donut", () => {
  for (const theme of THEMES) {
    it(`names itself, shows the total and a legend of counts and shares (${theme})`, () => {
      render(<Theme name={theme}><DonutChart label="AAR Priority" data={priority} /></Theme>);
      expect(document.querySelector(`[data-theme="${theme}"]`)).toBeTruthy();
      const ring = screen.getByRole("img", { name: "AAR Priority: 78 total. Low 55 (70%), Medium 20 (26%), High 3 (4%)." });
      expect(within(ring).getByText("78")).toBeTruthy();
      expect(within(ring).getByText("TOTAL")).toBeTruthy();
      expect(ring.querySelectorAll("path")).toHaveLength(3);
      const legend = screen.getByRole("list", { name: "AAR Priority legend" });
      expect([...legend.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Low 55 (70%)", "Medium 20 (26%)", "High 3 (4%)"]);
      // The series colors are themed variables, never a fixed hex.
      expect(ring.querySelector("path")!.getAttribute("fill")).toBe("var(--eoc-series-complete)");
    });
  }

  it("selects a slice from its legend row or the ring and offers VIEW per slice", () => {
    const onSelect = vi.fn();
    const onView = vi.fn();
    render(<DonutChart label="AAR Status" data={priority} selectedKey="medium" onSelect={onSelect} onView={onView} caption="AARs" />);
    const low = screen.getByRole("button", { name: "Low 55 (70%)" });
    expect(low.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Medium 20 (26%)" }).getAttribute("aria-pressed")).toBe("true");
    low.focus();
    expect(document.activeElement).toBe(low);
    fireEvent.click(low);
    expect(onSelect).toHaveBeenLastCalledWith("low");
    fireEvent.click(screen.getByRole("img").querySelectorAll("path")[2]!);
    expect(onSelect).toHaveBeenLastCalledWith("high");
    fireEvent.click(screen.getByRole("button", { name: "View High" }));
    expect(onView).toHaveBeenCalledWith("high");
    expect(screen.getByText("AARS")).toBeTruthy();
    // The unselected slices dim; the selected one does not.
    expect([...screen.getByRole("img").querySelectorAll("path")].map((path) => path.hasAttribute("data-dim"))).toEqual([true, false, true]);
  });

  it("draws a lone category as a whole ring", () => {
    render(<DonutChart label="Pace" data={[{ key: "late", label: "Past due", value: 6 }, { key: "on", label: "On time", value: 0 }]} />);
    const paths = screen.getByRole("img").querySelectorAll("path");
    expect(paths).toHaveLength(1);
    expect(paths[0]!.getAttribute("fill-rule")).toBe("evenodd");
    expect(screen.getByText("0 (0%)")).toBeTruthy();
  });

  it("reads honestly with nothing to count: no ring, the empty message, zero counts", () => {
    const { rerender } = render(<DonutChart label="Lists by Status" emptyLabel="No lists yet" data={[]} />);
    expect(screen.getByText("No lists yet")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    rerender(<DonutChart label="Lists by Status" emptyLabel="No lists yet" data={[{ key: "done", label: "Completed", value: 0 }]} />);
    expect(screen.getByText("No lists yet")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("0 (0%)")).toBeTruthy();
  });

  it("keeps an equivalent data table for screen readers", () => {
    render(<DonutChart label="AAR Priority" data={priority} />);
    const table = screen.getByRole("table", { name: "AAR Priority" });
    expect(table.className).toBe("eoc-visually-hidden");
    expect(within(table).getAllByRole("row").map((row) => row.textContent))
      .toEqual(["CategoryCountShare", "Low5570%", "Medium2026%", "High34%"]);
  });

  it("shows a tiny real share as under one percent", () => {
    render(<DonutChart label="Tasks" data={[{ key: "a", label: "A", value: 999 }, { key: "b", label: "B", value: 1 }]} />);
    expect(screen.getByText("1 (<1%)")).toBeTruthy();
  });
});

const capabilities = [
  { key: "access", label: "Access Control and Identity Verification", value: 4 },
  { key: "resilience", label: "Community Resilience", value: 0 },
  { key: "planning", label: "Planning", value: 12 },
];

describe("horizontal bars", () => {
  it("draws a named bar per category with its count and truncates long labels with a tooltip", () => {
    render(<HBarChart label="Core Capability" data={capabilities} />);
    const figure = screen.getByRole("figure", { name: "Core Capability: 3 categories, highest Planning (12)." });
    expect(within(figure).getAllByRole("img").map((bar) => bar.getAttribute("aria-label")))
      .toEqual(["Access Control and Identity Verification: 4", "Community Resilience: 0", "Planning: 12"]);
    expect((within(figure).getByRole("img", { name: "Planning: 12" }) as HTMLElement).style.width).toBe("100%");
    expect(within(figure).getByTitle("Access Control and Identity Verification")).toBeTruthy();
    expect(within(figure).getByRole("table", { name: "Core Capability" })).toBeTruthy();
  });

  it("selects a bar by click, reachable by keyboard", () => {
    const onSelect = vi.fn();
    render(<HBarChart label="Core Capability" data={capabilities} selectedKey={null} onSelect={onSelect} />);
    const planning = screen.getByRole("button", { name: "Planning: 12" });
    planning.focus();
    expect(document.activeElement).toBe(planning);
    expect(planning.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(planning);
    expect(onSelect).toHaveBeenCalledWith("planning");
  });

  it("says so when every count is zero", () => {
    render(<HBarChart label="Core Capability" emptyLabel="No capabilities rated yet" data={[{ key: "a", label: "A", value: 0 }]} />);
    expect(screen.getByText("No capabilities rated yet")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("vertical bars", () => {
  const elements = [
    { key: "none", label: "None", value: 59, color: statusPalette.approved },
    { key: "training", label: "Training", value: 12, color: statusPalette.complete },
    { key: "equipment", label: "Equipment", value: 9, color: statusPalette.inProgress },
  ];

  it("draws bars over a stepped y axis with category labels", () => {
    render(<VBarChart label="Capability Element" data={elements} />);
    const figure = screen.getByRole("figure", { name: "Capability Element: 3 categories, highest None (59)." });
    expect([...figure.querySelectorAll(".eoc-vbar-axis li")].map((tick) => tick.textContent)).toEqual(["0", "10", "20", "30", "40", "50", "60"]);
    expect(figure.querySelectorAll(".eoc-vbar-grid span")).toHaveLength(7);
    const bar = within(figure).getByRole("img", { name: "Training: 12" }) as HTMLElement;
    expect(bar.style.height).toBe("20%");
    expect(within(figure).getByTitle("Equipment").className).toBe("eoc-vbar-label");
  });

  it("selects a column by click, reachable by keyboard", () => {
    const onSelect = vi.fn();
    render(<VBarChart label="Capability Element" data={elements} onSelect={onSelect} />);
    const training = screen.getByRole("button", { name: "Training: 12" });
    training.focus();
    expect(document.activeElement).toBe(training);
    fireEvent.click(training);
    expect(onSelect).toHaveBeenCalledWith("training");
  });
});

describe("status tiles, chips and progress", () => {
  const plans = [
    { key: "not_started", label: "Not Started", value: 5, color: statusPalette.pastDue },
    { key: "in_progress", label: "In Progress", value: 3, color: statusPalette.inProgress },
    { key: "complete", label: "Complete", value: 45, color: statusPalette.complete },
  ];

  it("tiles filter by their status and show which one is on", () => {
    const onSelect = vi.fn();
    render(<StatusTiles label="Plans by status" items={plans} selectedKey="complete" onSelect={onSelect} />);
    const group = screen.getByRole("list", { name: "Plans by status" });
    expect(within(group).getByRole("button", { name: "45 Complete" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(group).getByRole("button", { name: "5 Not Started" }));
    expect(onSelect).toHaveBeenCalledWith("not_started");
  });

  it("tiles without a handler are plain counts", () => {
    render(<StatusTiles label="Plans by status" items={plans} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("45")).toBeTruthy();
  });

  it("chips toggle as filters", () => {
    const onToggle = vi.fn();
    render(<StatusChips label="Filter lists by status" items={plans} selectedKeys={["in_progress"]} onToggle={onToggle} />);
    expect(screen.getByRole("button", { name: "3 In Progress" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "5 Not Started" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "5 Not Started" }));
    expect(onToggle).toHaveBeenCalledWith("not_started");
  });

  it("progress reads x of y and percent, and turns complete at the end", () => {
    const { rerender } = render(<ProgressBar label="Power Outage forms" value={1} max={5} />);
    const bar = screen.getByRole("progressbar", { name: "Power Outage forms" });
    expect(bar.getAttribute("aria-valuetext")).toBe("1 of 5, 20%");
    expect(bar.textContent).toBe("1 of 520%");
    expect(bar.style.getPropertyValue("--eoc-chart-color")).toBe(statusPalette.inProgress);
    rerender(<ProgressBar label="Power Outage forms" value={5} max={5} />);
    expect(screen.getByRole("progressbar").style.getPropertyValue("--eoc-chart-color")).toBe(statusPalette.complete);
    rerender(<ProgressBar label="Power Outage forms" value={199} max={200} compact />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe("199 of 200, 99%");
    expect(screen.getByRole("progressbar").textContent).toBe("");
    rerender(<ProgressBar label="Empty plan" value={3} max={0} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe("0 of 0, 0%");
  });
});

describe("the chart card", () => {
  it("swaps the chart for its table and back from the kebab menu", () => {
    render(<ChartCard title="AAR Priority"><DonutChart data={priority} /></ChartCard>);
    const card = screen.getByRole("article", { name: "AAR Priority" });
    // The chart takes the card title as its name.
    expect(within(card).getByRole("img", { name: /^AAR Priority: 78 total/ })).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "AAR Priority options" }));
    fireEvent.click(within(card).getByRole("menuitem", { name: "Show as table" }));
    expect(within(card).queryByRole("img")).toBeNull();
    const table = within(card).getByRole("table", { name: "AAR Priority" });
    expect(table.className).toBe("eoc-chart-table");
    fireEvent.click(within(card).getByRole("button", { name: "AAR Priority options" }));
    fireEvent.click(within(card).getByRole("menuitem", { name: "Show as chart" }));
    expect(within(card).getByRole("img")).toBeTruthy();
  });

  it("opens the chart full screen in a dialog", () => {
    render(<ChartCard title="Capability Element"><DonutChart data={priority} /></ChartCard>);
    fireEvent.click(screen.getByRole("button", { name: "Capability Element options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Full screen" }));
    const dialog = screen.getByRole("dialog", { name: "Capability Element" });
    expect(within(dialog).getByRole("img").getAttribute("width")).toBe("280");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close Capability Element" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a table view keeps selection reachable", () => {
    const onSelect = vi.fn();
    render(<ChartCard title="Core Capability"><HBarChart data={capabilities} onSelect={onSelect} /></ChartCard>);
    fireEvent.click(screen.getByRole("button", { name: "Core Capability options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Show as table" }));
    fireEvent.click(screen.getByRole("button", { name: "Planning" }));
    expect(onSelect).toHaveBeenCalledWith("planning");
  });

  it("marks wide and tall cards for the grid", () => {
    render(<DashboardGrid label="AAR dashboard"><ChartCard title="Core Capability" rows={3} columns={2} menu={false}><p>x</p></ChartCard></DashboardGrid>);
    const card = within(screen.getByRole("region", { name: "AAR dashboard" })).getByRole("article");
    expect([card.dataset["columns"], card.dataset["rows"]]).toEqual(["2", "3"]);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("the kit in both themes", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../charts.css"), "utf8");
  const series = (theme: ThemeName) => {
    const block = new RegExp(`\\.eoc-theme\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    return Object.fromEntries([...block.matchAll(/--eoc-series-([a-z-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1]!, m[2]!]));
  };

  for (const theme of THEMES) {
    it(`takes every status series from the shared work status palette (${theme})`, () => {
      const expected = paletteCssVariables(WORK_STATUS_PALETTE, theme, "eoc-series");
      const css = Object.fromEntries(Object.entries(series(theme)).map(([name, color]) => [`--eoc-series-${name}`, color]));
      expect(css).toMatchObject(expected);
      expect(Object.values(statusPalette).map((value) => value.slice(4, -1)).sort()).toEqual(Object.keys(expected).sort());
    });

    it(`themes every status series, readable on the ${theme} surface and under its chip ink`, () => {
      const colors = series(theme);
      const names = Object.values(statusPalette).map((value) => /--eoc-series-([a-z-]+)/.exec(value)![1]!);
      for (const name of names) {
        const color = colors[name];
        expect(color, name).toBeDefined();
        expect(contrastRatio(color!, themes[theme].surface), name).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(colors["ink"]!, color!), `${name} ink`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`passes axe with every component on the page (${theme})`, async () => {
      const { container } = render(
        <Theme name={theme}>
          <StatusTiles label="Plans by status" items={[{ key: "a", label: "Not Started", value: 5, color: statusPalette.pastDue }]} onSelect={() => undefined} />
          <StatusChips label="Filter by status" items={[{ key: "a", label: "Past Due", value: 6, color: statusPalette.pastDue }]} onToggle={() => undefined} />
          <ProgressBar label="Plan forms" value={1} max={5} />
          <DashboardGrid label="Dashboard">
            <ChartCard title="AAR Priority"><DonutChart data={priority} onSelect={() => undefined} onView={() => undefined} /></ChartCard>
            <ChartCard title="Core Capability"><HBarChart data={capabilities} onSelect={() => undefined} /></ChartCard>
            <ChartCard title="Capability Element"><VBarChart data={capabilities} onSelect={() => undefined} /></ChartCard>
          </DashboardGrid>
        </Theme>,
      );
      expect((await axe.run(container, { rules: { region: { enabled: false } } })).violations).toEqual([]);
    });
  }
});
