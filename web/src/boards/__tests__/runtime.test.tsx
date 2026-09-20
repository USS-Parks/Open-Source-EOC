// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STANDARD_TEMPLATES, templateDiff, rollbackDraft } from "@openeoc/shared";
import { BoardView } from "../BoardView.js";
import { RecordForm } from "../RecordForm.js";

afterEach(cleanup);

const shelters = STANDARD_TEMPLATES.find((t) => t.key === "shelters")!;

describe("RecordForm (input view)", () => {
  it("renders enumerated controls from the dictionary and submits a valid record", () => {
    const onSubmit = vi.fn();
    render(<RecordForm fields={shelters.fields} onSubmit={onSubmit} />);
    const status = screen.getByLabelText("Status") as HTMLSelectElement;
    expect([...status.options].map((o) => o.value)).toContain("evacuating");
    fireEvent.change(screen.getByLabelText("Shelter"), { target: { value: "Hoopa High Gym" } });
    fireEvent.change(status, { target: { value: "normal" } });
    fireEvent.change(screen.getByLabelText("Capacity"), { target: { value: "150" } });
    fireEvent.change(screen.getByLabelText("Occupancy"), { target: { value: "112" } });
    fireEvent.click(screen.getByText("Save record"));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Hoopa High Gym",
      status: "normal",
      capacity: 150,
      occupancy: 112,
    });
  });

  it("blocks an invalid record with a visible error and no submit", () => {
    const onSubmit = vi.fn();
    render(<RecordForm fields={shelters.fields} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText("Save record"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("prefills a geometry point (the map tap) and submits it as GeoJSON", () => {
    const roads = STANDARD_TEMPLATES.find((t) => t.key === "road_closures")!;
    const onSubmit = vi.fn();
    render(
      <RecordForm
        fields={roads.fields}
        initial={{ location: { type: "Point", coordinates: [-123.6, 41.3] } }}
        onSubmit={onSubmit}
      />,
    );
    expect((screen.getByLabelText("Longitude") as HTMLInputElement).value).toBe("-123.6");
    expect((screen.getByLabelText("Latitude") as HTMLInputElement).value).toBe("41.3");
    fireEvent.change(screen.getByLabelText("Road"), { target: { value: "SR-169" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Slide" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "closed" } });
    fireEvent.click(screen.getByText("Save record"));
    expect(onSubmit).toHaveBeenCalledWith({
      road: "SR-169",
      reason: "Slide",
      status: "closed",
      location: { type: "Point", coordinates: [-123.6, 41.3] },
    });
  });

  it("uploads a photo attachment through the capture hook and submits its id", async () => {
    const fr = STANDARD_TEMPLATES.find((t) => t.key === "field_reports")!;
    const onSubmit = vi.fn();
    const onUpload = vi.fn(async () => "22222222-2222-4222-8222-222222222222");
    render(<RecordForm fields={fr.fields} onSubmit={onSubmit} onUpload={onUpload} />);
    fireEvent.change(screen.getByLabelText("Summary"), { target: { value: "Washout" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "damage" } });
    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Photo"), { target: { files: [file] } });
    await screen.findByText("attached ✓", { exact: false });
    fireEvent.click(screen.getByText("Save record"));
    expect(onUpload).toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: "Washout",
        category: "damage",
        photo: "22222222-2222-4222-8222-222222222222",
      }),
    );
  });
});

describe("BoardView (display view)", () => {
  const records = [
    { id: "1", name: "Hoopa High Gym", status: "normal", capacity: 150, occupancy: 112 },
    { id: "2", name: "Closed Hall", status: "closed", capacity: 40, occupancy: 0 },
  ];

  it("applies the view filter and renders labels, not keys", () => {
    render(<BoardView template={shelters} viewKey="open" records={records} />);
    expect(screen.getByText("Hoopa High Gym")).toBeTruthy();
    expect(screen.queryByText("Closed Hall")).toBeNull();
    expect(screen.getByText("Shelter")).toBeTruthy();
  });

  it("re-renders when records change (the live loop's rendering half)", () => {
    const { rerender } = render(
      <BoardView template={shelters} viewKey="all" records={records} />,
    );
    expect(screen.queryByText("New Shelter")).toBeNull();
    rerender(
      <BoardView
        template={shelters}
        viewKey="all"
        records={[...records, { id: "3", name: "New Shelter", status: "normal", capacity: 10, occupancy: 1 }]}
      />,
    );
    expect(screen.getByText("New Shelter")).toBeTruthy();
  });
});

describe("diff and rollback", () => {
  it("reports added, removed, and changed structure", () => {
    const v2 = {
      ...shelters,
      version: 2,
      fields: [
        ...shelters.fields.filter((f) => f.key !== "pets_accepted"),
        { ...shelters.fields.find((f) => f.key === "capacity")!, label: "Max capacity" },
        { key: "generator", label: "Generator", type: "text" as const, required: false, read: "any" as const, write: "member" as const },
      ],
    };
    const diff = templateDiff(shelters, v2);
    expect(diff.addedFields).toEqual(["generator"]);
    expect(diff.removedFields).toEqual(["pets_accepted"]);
    expect(diff.changedFields).toEqual(["capacity"]);
  });

  it("rollback restores old content under a new version, never rewriting history", () => {
    const draft = rollbackDraft(shelters, 5);
    expect(draft.version).toBe(6);
    expect(draft.fields).toEqual(shelters.fields);
  });
});
