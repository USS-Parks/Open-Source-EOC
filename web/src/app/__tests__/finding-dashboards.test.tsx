// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { openOnDashboard, Tabs } from "../../design/controls.js";
import { readAllSections } from "../screens/Console.js";

/**
 * An evaluator finds the dashboards: the desktop demonstration lists every
 * section until the person chooses otherwise, and each screen's Dashboard tab
 * reopens when the person left the screen on it.
 */

const g = globalThis as { OPENEOC?: Record<string, string> };

afterEach(() => {
  cleanup();
  delete g.OPENEOC;
  localStorage.clear();
  sessionStorage.clear();
});

describe("the rail's every-section default", () => {
  it("lists every section in a synthetic demonstration when the person has not chosen", () => {
    g.OPENEOC = { OPENEOC_SYNTHETIC_DATA: "1", OPENEOC_DEMO_ALL_SECTIONS: "1" };
    expect(readAllSections()).toBe(true);
  });

  it("keeps the person's own choice over the demonstration's default", () => {
    g.OPENEOC = { OPENEOC_SYNTHETIC_DATA: "1", OPENEOC_DEMO_ALL_SECTIONS: "1" };
    localStorage.setItem("openeoc.navigation.allSections", "0");
    expect(readAllSections()).toBe(false);
    localStorage.setItem("openeoc.navigation.allSections", "1");
    expect(readAllSections()).toBe(true);
  });

  it("keeps the frames' twelve sections without the flag, and on real data even with it", () => {
    expect(readAllSections()).toBe(false);
    g.OPENEOC = { OPENEOC_DEMO_ALL_SECTIONS: "1" };
    expect(readAllSections()).toBe(false);
  });
});

function Screen(props: { readonly id: string; readonly dashboard?: boolean }) {
  const [tab, setTab] = useState("records");
  return (
    <Tabs id={props.id} label="Views" value={tab} onChange={setTab}
      tabs={[{ id: "records", label: "Records" }, ...(props.dashboard === false ? [] : [{ id: "dashboard", label: "Dashboard" }])]} />
  );
}

const selected = () => screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;

describe("a screen's Dashboard tab", () => {
  it("reopens when the person left the screen on it, and not after they left it", () => {
    render(<Screen id="aar-view" />);
    expect(selected()).toBe("Records");
    fireEvent.click(screen.getByRole("tab", { name: "Dashboard" }));
    cleanup();
    render(<Screen id="aar-view" />);
    expect(selected()).toBe("Dashboard");
    // Other screens keep their own choice.
    cleanup();
    render(<Screen id="iap-view" />);
    expect(selected()).toBe("Records");
    cleanup();
    render(<Screen id="aar-view" />);
    fireEvent.click(screen.getByRole("tab", { name: "Records" }));
    cleanup();
    render(<Screen id="aar-view" />);
    expect(selected()).toBe("Records");
  });

  it("opens from a link that asks for it", () => {
    openOnDashboard("resources-view");
    render(<Screen id="resources-view" />);
    expect(selected()).toBe("Dashboard");
  });

  it("leaves tabs without a Dashboard alone", () => {
    sessionStorage.setItem("openeoc.dashboardTab.record-detail", "1");
    render(<Screen id="record-detail" dashboard={false} />);
    expect(selected()).toBe("Records");
  });
});
