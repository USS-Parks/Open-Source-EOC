// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Theme } from "../components.js";
import { ActionCard, ConditionCard, KpiCard } from "../cards.js";
import { ActionButton, Menu, ProgressIndicator, Tabs, Tooltip } from "../controls.js";
import { CountBadge, EmptyState, ErrorState, LoadingState } from "../feedback.js";

afterEach(cleanup);

describe("D06 state precision", () => {
  it("renders reported zero and unknown as distinct non-success states", () => {
    const { container, getByLabelText } = render(
      <Theme name="light">
        <KpiCard label="Shelters reporting" value={{ kind: "zero" }} />
        <KpiCard label="Damage estimate" value={{ kind: "unknown" }} />
        <CountBadge value={0} label="Open missions" />
        <CountBadge value={null} label="Unverified reports" />
      </Theme>,
    );
    expect(container.querySelector('[data-value-state="zero"]')).not.toBeNull();
    expect(container.querySelector('[data-value-state="unknown"]')).not.toBeNull();
    expect(getByLabelText("Open missions: zero").getAttribute("data-count-state")).toBe("zero");
    expect(getByLabelText("Unverified reports: unknown").getAttribute("data-count-state")).toBe("unknown");
    expect(container.querySelector('[data-value-state="zero"] [data-state="normal"]')).toBeNull();
  });

  it("normalizes a numeric zero passed as a value into the zero treatment", () => {
    const { container } = render(<Theme name="light"><KpiCard label="Closed" value={{ kind: "value", value: 0 }} /></Theme>);
    expect(container.querySelector("article")?.getAttribute("data-value-state")).toBe("zero");
  });

  it("accepts a leading slot and domain condition label without changing generic state", () => {
    const { getByText, container } = render(
      <Theme name="light">
        <ConditionCard title="Energy" state="critical" stateLabel="Disrupted" leading={<span>EN</span>} summary="Two substations offline" />
      </Theme>,
    );
    expect(getByText("Disrupted")).not.toBeNull();
    expect(getByText("EN").closest(".eoc-kit-condition-leading")).not.toBeNull();
    expect(container.querySelector('[data-state="critical"]')).not.toBeNull();
  });
});

describe("D06 actions", () => {
  it("marks primary action with structure and disables a busy action", () => {
    const onClick = vi.fn();
    const { getByRole } = render(
      <Theme name="light">
        <ActionButton kind="primary" onClick={onClick}>Create report</ActionButton>
        <ActionButton loading onClick={onClick}>Save</ActionButton>
      </Theme>,
    );
    const primary = getByRole("button", { name: "Create report" });
    expect(primary.getAttribute("data-primary")).toBe("true");
    expect(primary.className).toContain("is-primary");
    const busy = getByRole("button", { name: "Working…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(busy);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps action-card labels out of DOM attributes", () => {
    const { getByRole } = render(
      <Theme name="light">
        <ActionCard title="Request" summary="Review the assignment" primaryAction={{ label: "Assign", onClick: () => undefined }} />
      </Theme>,
    );
    expect(getByRole("button", { name: "Assign" }).hasAttribute("label")).toBe(false);
  });
});

describe("D06 keyboard controls", () => {
  function TabsHarness() {
    const [value, setValue] = useState("one");
    return (
      <Theme name="light">
        <Tabs id="test-tabs" label="Views" value={value} onChange={setValue} tabs={[{ id: "one", label: "One" }, { id: "disabled", label: "Disabled", disabled: true }, { id: "two", label: "Two" }]} />
        <section id={`test-tabs-${value}-panel`} role="tabpanel" aria-labelledby={`test-tabs-${value}-tab`}>{value}</section>
      </Theme>
    );
  }

  it("uses roving focus and skips disabled tabs", () => {
    const { getByRole } = render(<TabsHarness />);
    const one = getByRole("tab", { name: "One" });
    one.focus();
    fireEvent.keyDown(one, { key: "ArrowRight" });
    const two = getByRole("tab", { name: "Two" });
    expect(two.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(two);
    fireEvent.keyDown(two, { key: "Home" });
    expect(document.activeElement).toBe(one);
  });

  it("opens, traverses, selects, and closes a menu from the keyboard", () => {
    const selected = vi.fn();
    const { getByRole } = render(
      <Theme name="light">
        <Menu label="More actions" items={[{ id: "first", label: "First action", onSelect: selected }, { id: "off", label: "Unavailable", disabled: true, onSelect: selected }, { id: "last", label: "Last action", onSelect: selected }]} />
      </Theme>,
    );
    const trigger = getByRole("button", { name: "More actions" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(getByRole("menu")).not.toBeNull();
    const first = getByRole("menuitem", { name: "First action" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowUp" });
    const last = getByRole("menuitem", { name: "Last action" });
    expect(document.activeElement).toBe(last);
    fireEvent.click(last);
    expect(selected).toHaveBeenCalledOnce();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("focuses the first item for Enter or click and closes when focus leaves or Escape reaches the trigger", () => {
    const { getByRole, queryByRole } = render(
      <Theme name="light">
        <Menu label="Options" items={[{ id: "first", label: "First option", onSelect: () => undefined }]} />
        <button type="button">Outside</button>
      </Theme>,
    );
    const trigger = getByRole("button", { name: "Options" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(document.activeElement).toBe(getByRole("menuitem", { name: "First option" }));
    const outside = getByRole("button", { name: "Outside" });
    fireEvent.blur(getByRole("menuitem", { name: "First option" }), { relatedTarget: outside });
    fireEvent.focus(outside);
    expect(queryByRole("menu")).toBeNull();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(getByRole("menuitem", { name: "First option" }));
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("shows a tooltip on focus and removes it on blur", () => {
    const { getByRole, queryByRole } = render(
      <Theme name="light">
        <span id="base-description">Existing detail</span>
        <Tooltip text="Last confirmed synchronization"><button type="button" aria-describedby="base-description">Sync details</button></Tooltip>
      </Theme>,
    );
    const button = getByRole("button", { name: "Sync details" });
    fireEvent.focus(button);
    expect(getByRole("tooltip").textContent).toContain("Last confirmed");
    expect(button.getAttribute("aria-describedby")?.split(" ")).toContain("base-description");
    expect(button.getAttribute("aria-describedby")?.split(" ")).toContain(getByRole("tooltip").id);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(queryByRole("tooltip")).toBeNull();
    expect(button.getAttribute("aria-describedby")).toBe("base-description");
    fireEvent.focus(button);
    expect(getByRole("tooltip")).not.toBeNull();
    fireEvent.blur(button);
    expect(queryByRole("tooltip")).toBeNull();
  });
});

describe("D06 progress and feedback", () => {
  it("represents determinate, complete, and indeterminate progress without false completion", () => {
    const { getByRole, rerender } = render(<Theme name="light"><ProgressIndicator label="Upload" value={30} /></Theme>);
    expect(getByRole("progressbar").getAttribute("aria-valuenow")).toBe("30");
    expect(getByRole("progressbar").closest(".eoc-kit-progress")?.hasAttribute("data-complete")).toBe(false);
    rerender(<Theme name="light"><ProgressIndicator label="Upload" /></Theme>);
    expect(getByRole("progressbar").hasAttribute("aria-valuenow")).toBe(false);
    expect(getByRole("progressbar").getAttribute("aria-valuetext")).toBe("In progress");
    rerender(<Theme name="light"><ProgressIndicator label="Upload" value={100} /></Theme>);
    expect(getByRole("progressbar").closest(".eoc-kit-progress")?.getAttribute("data-complete")).toBe("true");
  });

  it("rejects invalid progress bounds", () => {
    expect(() => render(<ProgressIndicator label="Bad" max={0} />)).toThrow(RangeError);
    expect(() => render(<ProgressIndicator label="Bad" value={101} />)).toThrow(RangeError);
  });

  it("uses status, neutral empty, and alert semantics", () => {
    const { getByRole, getByText } = render(
      <Theme name="dark">
        <LoadingState label="Loading reports" />
        <EmptyState title="No records" description="No records match this filter." />
        <ErrorState title="Could not load" message="Try again." />
      </Theme>,
    );
    expect(getByRole("status").getAttribute("aria-busy")).toBe("true");
    expect(getByText("No records").closest("[role]")).toBeNull();
    expect(getByRole("alert").textContent).toContain("Could not load");
  });
});
