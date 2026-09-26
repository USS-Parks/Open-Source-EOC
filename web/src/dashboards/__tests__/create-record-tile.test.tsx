// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardComposition, DashboardCompositionSnapshot, FieldDef } from "@openeoc/shared";
import type { EffectiveBoardResponse } from "../../app/api/client.js";
import { CompositionDashboard } from "../CompositionDashboard.js";
import { DashboardConfigurator } from "../DashboardConfigurator.js";

vi.mock("../../cop/CopMap.js", () => ({ CopMap: () => <div>COP map</div> }));

afterEach(cleanup);

const boardId = "20000000-0000-4000-8000-000000000002";
const fields: FieldDef[] = [
  { key: "item", label: "Item", type: "text", required: true, read: "any", write: "member" },
  { key: "status", label: "Status", type: "enum", values: ["open", "filled"], required: false, read: "any", write: "member" },
  { key: "quantity", label: "Quantity", type: "number", required: false, read: "any", write: "member" },
];
const board: EffectiveBoardResponse = {
  id: boardId, title: "Supply requests", templateKey: "tile_requests", templateVersion: 1,
  role: "member", canContribute: true, fields, views: [],
};
const composition: DashboardComposition = {
  title: "Requests desk",
  panels: [{ key: "new_request", source: "create", presentation: "tile", boardId, presets: { status: "open", quantity: 2 } }],
};

function snapshot(canCreate: boolean): DashboardCompositionSnapshot {
  return {
    key: "desk", revision: 1, title: "Requests desk", computedAt: "2026-09-25T12:00:00.000Z",
    scope: { kind: "incident-area", bbox: null }, filterMode: "inherit", filters: null, resolvedOperationalPeriod: null,
    panels: [{
      key: "new_request", title: "New Supply requests record", source: "create", presentation: "tile", state: "ready",
      reason: canCreate ? null : "You can read this board but not add records to it.",
      filterCapabilities: [], contributionDrilldown: false, notApplied: [],
      data: {
        kind: "create", boardId, boardTitle: "Supply requests", canCreate,
        presets: [
          { field: "status", label: "Status", value: "open", text: "Open" },
          { field: "quantity", label: "Quantity", value: 2, text: "2" },
        ],
      },
    }],
  };
}

function dashboard(canCreate: boolean) {
  const actions = {
    loadBoard: vi.fn().mockResolvedValue(board),
    create: vi.fn().mockResolvedValue({ id: "30000000-0000-4000-8000-000000000003" }),
    onCreated: vi.fn(),
  };
  const view = render(
    <CompositionDashboard snapshot={snapshot(canCreate)} composition={composition} theme="light"
      loadMapRecords={vi.fn()} onDrill={vi.fn()} createRecord={actions} />,
  );
  return { view, actions };
}

describe("create-record tiles", () => {
  it("opens the board's form in place with the presets and saves the record", async () => {
    const { view, actions } = dashboard(true);
    const tile = view.getByRole("article", { name: "New Supply requests record" });
    expect(tile.textContent).toContain("Starts with Status: Open, Quantity: 2");
    expect((await axe.run(view.container)).violations).toEqual([]);

    fireEvent.click(within(tile).getByRole("button", { name: "New Supply requests record" }));
    const dialog = await screen.findByRole("dialog", { name: "New Supply requests record" });
    expect(actions.loadBoard).toHaveBeenCalledWith(boardId);
    await within(dialog).findByLabelText(/Item/);
    expect((within(dialog).getByLabelText(/Status/) as HTMLSelectElement).value).toBe("open");
    expect((within(dialog).getByLabelText(/Quantity/) as HTMLInputElement).value).toBe("2");
    expect((await axe.run(document.body)).violations).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText(/Item/), { target: { value: "Cots" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save record" }));
    await waitFor(() => expect(actions.create).toHaveBeenCalledWith(boardId, { item: "Cots", status: "open", quantity: 2 }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(tile).getByRole("status").textContent).toBe("Record saved to Supply requests.");
    expect(actions.onCreated).toHaveBeenCalledTimes(1);
  });

  it("shows a viewer who cannot write the tile disabled, with the reason", async () => {
    const { view, actions } = dashboard(false);
    const button = view.getByRole("button", { name: "New Supply requests record" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(actions.loadBoard).not.toHaveBeenCalled();
    expect(view.getByText("You can read this board but not add records to it.")).toBeTruthy();
    expect((await axe.run(view.container)).violations).toEqual([]);
  });

  it("adds a create-record tile with preset values to a saved view", async () => {
    const onSave = vi.fn();
    const loadBoard = vi.fn().mockResolvedValue({ fields });
    const view = render(
      <DashboardConfigurator current={null} initialKey="desk" dashboards={[]} saving={false} error={null}
        onSave={onSave} onCancel={() => undefined}
        boards={[{ id: boardId, title: "Supply requests" }]} loadBoard={loadBoard} />,
    );
    const section = view.getByRole("group", { name: "Create-record tiles" });
    fireEvent.change(within(section).getByLabelText("Board for a new tile"), { target: { value: boardId } });
    await waitFor(() => expect((within(section).getByRole("button", { name: "Add a preset value" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(section).getByRole("button", { name: "Add a preset value" }));
    fireEvent.change(within(section).getByLabelText("Preset 1 field"), { target: { value: "status" } });
    fireEvent.change(within(section).getByLabelText("Preset 1 value"), { target: { value: "filled" } });
    fireEvent.click(within(section).getByRole("button", { name: "Add a preset value" }));
    fireEvent.change(within(section).getByLabelText("Preset 2 field"), { target: { value: "quantity" } });
    fireEvent.change(within(section).getByLabelText("Preset 2 value"), { target: { value: "4" } });
    fireEvent.change(within(section).getByLabelText(/Tile label/), { target: { value: "Log a filled request" } });
    expect((await axe.run(view.container)).violations).toEqual([]);
    fireEvent.click(within(section).getByRole("button", { name: "Add create-record tile" }));
    expect(within(section).getByText("Log a filled request")).toBeTruthy();
    expect(within(section).getByText("2 preset values")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Save view" }));
    expect(onSave.mock.calls[0]?.[2]).toEqual({
      title: "Incident overview",
      panels: [{
        key: "create_1", source: "create", presentation: "tile", boardId, title: "Log a filled request",
        presets: { status: "filled", quantity: 4 },
      }],
    });
  });
});
