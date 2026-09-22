// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Theme } from "../../../design/components.js";
import { AppShell, type AppShellProps, type NavGroup } from "../AppShell.js";

afterEach(() => {
  cleanup();
  window.location.hash = "";
  vi.unstubAllGlobals();
});

function atWidth(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 760px)" ? width <= 760 : width >= 1181,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  }));
}

const nav: readonly NavGroup[] = [
  { key: "situation", label: "Situation", items: [
    { key: "overview", label: "Overview", icon: "overview" },
    { key: "map", label: "Map", icon: "map" },
  ] },
  { key: "operations", label: "Operations", items: [
    { key: "boards", label: "Boards", icon: "boards" },
  ] },
  { key: "planning", label: "Planning", items: [
    { key: "iap", label: "IAP", icon: "iap" },
  ] },
  { key: "coordination", label: "Coordination", items: [
    { key: "messages", label: "Messages", icon: "messages" },
  ] },
  { key: "data", label: "Data and administration", items: [
    { key: "settings", label: "Settings", icon: "settings" },
  ] },
];

function props(overrides: Partial<AppShellProps> = {}): AppShellProps {
  return {
    product: "Open Source EOC",
    organization: "Emergency coordination",
    context: <label>Incident<select aria-label="Selected incident" defaultValue="storm"><option value="storm">North Coast Storm</option></select></label>,
    periodLabel: "Not set",
    positionLabel: "Planning Section",
    nav,
    activeNav: "map",
    onNavigate: vi.fn(),
    userName: "Jordan Diaz",
    roleLabel: "member",
    theme: "light",
    onToggleTheme: vi.fn(),
    onLogout: vi.fn(),
    notificationCount: 3,
    sync: { state: "current", label: "Checked 09:42" },
    page: { group: "Situation", title: "Map", scope: "North Coast Storm" },
    arrangement: "map",
    rightDock: <p>Current record context</p>,
    children: <button type="button">Map action</button>,
    ...overrides,
  };
}

function frame(overrides: Partial<AppShellProps> = {}) {
  return render(<Theme name="light"><AppShell {...props(overrides)} /></Theme>);
}

describe("responsive shell frame", () => {
  it("keeps five labeled groups, a named current route, and account controls", () => {
    const view = frame();
    for (const group of nav) expect(view.getByRole("heading", { name: group.label })).not.toBeNull();
    expect(view.getByRole("button", { name: "Map" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(view.getByRole("button", { name: "Account menu" }));
    expect(view.getByRole("button", { name: "Use dark theme" })).not.toBeNull();
    expect(view.getByRole("button", { name: "Sign out" })).not.toBeNull();
    expect(view.getAllByText("Planning Section")).toHaveLength(2);
  });

  it("compacts navigation without removing accessible destination names", () => {
    const view = frame();
    const toggle = view.getByRole("button", { name: "Compact navigation" });
    fireEvent.click(toggle);
    expect(view.getByRole("button", { name: "Expand navigation" })).not.toBeNull();
    expect(view.getByRole("button", { name: "Overview" })).not.toBeNull();
    expect(view.getByRole("button", { name: "Settings" })).not.toBeNull();
  });

  it("skips without changing the hash route", () => {
    const view = frame();
    window.location.hash = "#/board/current";
    fireEvent.click(view.getByRole("link", { name: "Skip to workspace" }));
    expect(window.location.hash).toBe("#/board/current");
    expect(document.activeElement).toBe(view.getByRole("main"));
  });

  it("resizes, dismisses, and restores focus for the context drawer", async () => {
    const view = frame();
    const separator = view.getByRole("separator", { name: "Resize context drawer" });
    expect(separator.getAttribute("aria-valuenow")).toBe("340");
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(separator.getAttribute("aria-valuenow")).toBe("356");
    fireEvent.click(view.getByRole("button", { name: "Close context drawer" }));
    const opener = view.getByRole("button", { name: "Open context" });
    opener.focus();
    fireEvent.click(opener);
    await waitFor(() => expect(document.activeElement).toBe(view.getByRole("heading", { name: "Context" })));
    fireEvent.keyDown(view.getByRole("complementary"), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(view.getByRole("button", { name: "Open context" })));
  });

  it("hides the closed narrow rail, traps its focus, and moves focus to the workspace after navigation", async () => {
    atWidth(390);
    const onNavigate = vi.fn();
    const view = frame({ onNavigate });
    const rail = view.container.querySelector<HTMLElement>("#eoc-shell-navigation")!;
    expect(rail.hasAttribute("inert")).toBe(true);
    expect(rail.getAttribute("aria-hidden")).toBe("true");
    expect(view.queryByRole("button", { name: "Map" })).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "All sections" }));
    const close = await view.findByRole("button", { name: "Close sections" });
    await waitFor(() => expect(document.activeElement).toBe(close));
    expect(rail.hasAttribute("inert")).toBe(false);
    const last = within(rail).getByRole("button", { name: "Settings" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(rail, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(view.getByRole("button", { name: "All sections" })));

    fireEvent.click(view.getByRole("button", { name: "All sections" }));
    fireEvent.click(await view.findByRole("button", { name: "Map" }));
    expect(onNavigate).toHaveBeenCalledWith("map");
    await waitFor(() => expect(document.activeElement).toBe(view.getByRole("main")));
  });

  it("makes the overlay drawer modal and contains focus away from covered controls", async () => {
    atWidth(900);
    const view = frame();
    expect(view.queryByRole("dialog", { name: "Context" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Open context" }));
    const dialog = await view.findByRole("dialog", { name: "Context" });
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("heading", { name: "Context" })));
    const backdrop = view.container.querySelector<HTMLElement>(".eoc-shell-drawer-overlay")!;
    expect(backdrop.tagName).toBe("DIV");
    backdrop.focus();
    expect(document.activeElement).toBe(within(dialog).getByRole("heading", { name: "Context" }));
    expect(view.container.querySelector("main")?.hasAttribute("inert")).toBe(true);
    expect(view.container.querySelector("nav")?.hasAttribute("inert")).toBe(true);
    expect(view.container.querySelector("header")?.hasAttribute("inert")).toBe(true);
    expect(view.container.querySelector("header")?.getAttribute("aria-hidden")).toBe("true");
    expect(view.container.querySelector(".eoc-shell-skip")?.hasAttribute("inert")).toBe(true);
    expect(view.queryByRole("link", { name: "Skip to workspace" })).toBeNull();
    const first = within(dialog).getByRole("separator", { name: "Resize context drawer" });
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close context drawer" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(view.getByRole("button", { name: "Open context" })));
    expect(view.container.querySelector("main")?.hasAttribute("inert")).toBe(false);
    expect(view.container.querySelector("header")?.hasAttribute("inert")).toBe(false);
    expect(view.getByRole("link", { name: "Skip to workspace" }).hasAttribute("inert")).toBe(false);
  });

  it("skips the hidden narrow resizer when entering drawer controls", async () => {
    atWidth(390);
    const view = frame();
    fireEvent.click(view.getByRole("button", { name: "Open context" }));
    const dialog = await view.findByRole("dialog", { name: "Context" });
    const heading = within(dialog).getByRole("heading", { name: "Context" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(within(dialog).queryByRole("separator", { name: "Resize context drawer" })).toBeNull();
    fireEvent.keyDown(heading, { key: "Tab" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close context drawer" }));
  });

  it("removes pointer resize listeners when touch resize is cancelled", () => {
    const view = frame();
    const separator = view.getByRole("separator", { name: "Resize context drawer" });
    Object.defineProperties(separator, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => false) },
    });
    fireEvent.pointerDown(separator, { clientX: 500, pointerId: 4 });
    fireEvent.pointerMove(window, { clientX: 480, pointerId: 4 });
    expect(separator.getAttribute("aria-valuenow")).toBe("360");
    fireEvent.pointerCancel(window, { pointerId: 4 });
    fireEvent.pointerMove(window, { clientX: 460, pointerId: 4 });
    expect(separator.getAttribute("aria-valuenow")).toBe("360");
  });

  it("hydrates and reports controlled arrangement layout changes", () => {
    const onLayoutChange = vi.fn();
    const view = frame({
      layout: { compactNavigation: true, drawerOpen: false, drawerWidth: 404 },
      onLayoutChange,
      periodControl: <select aria-label="Operational period"><option>Day 2</option></select>,
      positionControl: <select aria-label="Acting position"><option>Planning Section</option></select>,
    });
    expect(view.getByRole("button", { name: "Expand navigation" })).not.toBeNull();
    expect(view.getByRole("button", { name: "Open context" })).not.toBeNull();
    expect(view.getByLabelText("Operational period")).not.toBeNull();
    expect(view.getByLabelText("Acting position")).not.toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Expand navigation" }));
    expect(onLayoutChange).toHaveBeenCalledWith({ compactNavigation: false, drawerOpen: false, drawerWidth: 404 });
    fireEvent.click(view.getByRole("button", { name: "Open context" }));
    expect(onLayoutChange).toHaveBeenCalledWith({ compactNavigation: false, drawerOpen: true, drawerWidth: 404 });
  });

  it("labels notification count and honest poll state", () => {
    const view = frame({ sync: { state: "error", label: "Updates unavailable" }, notificationCount: 0 });
    expect(view.getByRole("button", { name: "Notifications, 0 unread" })).not.toBeNull();
    expect(view.getAllByText("Updates unavailable").length).toBeGreaterThan(0);
    expect(view.queryByText("live")).toBeNull();
  });

  it("has no automated accessibility violations in the wide frame", async () => {
    const view = frame();
    const result = await axe.run(view.container, { rules: { "color-contrast": { enabled: false } } });
    const summary = result.violations.map((item) => `${item.id}: ${item.nodes.length}`).join("; ");
    expect(result.violations, summary).toHaveLength(0);
  }, 30000);
});
