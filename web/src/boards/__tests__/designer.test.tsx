// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allEnums, BoardTemplateSchema, STANDARD_TEMPLATES, type BoardTemplate } from "@openeoc/shared";
import { Designer } from "../Designer.js";

afterEach(cleanup);

function setByLabel(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function addField(input: {
  key: string;
  label: string;
  type?: string;
  enumId?: string;
  required?: boolean;
}) {
  setByLabel("Field key", input.key);
  setByLabel("Field label", input.label);
  if (input.type) setByLabel("Field type", input.type);
  if (input.enumId) setByLabel("Enumeration", input.enumId);
  if (input.required) fireEvent.click(screen.getByLabelText("Required"));
  fireEvent.click(screen.getByRole("button", { name: "Add field" }));
}

describe("no-code designer (INV-6)", () => {
  it("an administrator builds a working shelter board from nothing, no code", () => {
    const onSave = vi.fn();
    render(<Designer onSave={onSave} />);

    setByLabel("Board key", "camp_shelters");
    setByLabel("Board title", "Camp Shelters");

    addField({ key: "name", label: "Shelter name", required: true });
    addField({ key: "status", label: "Status", type: "enum", enumId: "have.facility_operating_status", required: true });
    addField({ key: "capacity", label: "Capacity", type: "number" });

    fireEvent.click(screen.getByRole("tab", { name: "Views" }));
    setByLabel("View key", "all");
    setByLabel("View title", "All shelters");
    fireEvent.click(screen.getByRole("group", { name: "View columns" }).querySelectorAll("input")[0]!);
    fireEvent.click(screen.getByRole("group", { name: "View columns" }).querySelectorAll("input")[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Add view" }));

    fireEvent.click(screen.getByText("Publish version 1"));
    expect(onSave).toHaveBeenCalledTimes(1);
    const template = onSave.mock.calls[0]![0] as BoardTemplate;
    expect(() => BoardTemplateSchema.parse(template)).not.toThrow();
    expect(template.key).toBe("camp_shelters");
    expect(template.version).toBe(1);
    expect(template.fields.map((f) => f.key)).toEqual(["name", "status", "capacity"]);
    expect(template.fields[1]!.enumId).toBe("have.facility_operating_status");
    expect(template.views[0]!.columns).toEqual(["name", "status"]);
  });

  it("has no code escape hatch by construction", () => {
    const { container } = render(<Designer onSave={() => undefined} />);
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
    expect(container.querySelectorAll("[contenteditable]")).toHaveLength(0);
    for (const input of container.querySelectorAll("input")) {
      expect(["text", "checkbox"]).toContain(input.type);
    }
  });

  it("refuses an invalid draft and shows why", () => {
    const onSave = vi.fn();
    render(<Designer onSave={onSave} />);
    setByLabel("Board key", "bad");
    setByLabel("Board title", "Bad Board");
    fireEvent.click(screen.getByText("Publish version 1"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("editing an existing template shows the structural diff and bumps the version", () => {
    const base = STANDARD_TEMPLATES.find((t) => t.key === "shelters")!;
    const onSave = vi.fn();
    render(<Designer base={base} onSave={onSave} />);
    addField({ key: "generator", label: "Has generator" });
    fireEvent.click(screen.getByRole("tab", { name: "Review & preview" }));
    expect(screen.getByTestId("diff").textContent).toContain("added: generator");
    fireEvent.click(screen.getByText(`Publish version ${base.version + 1}`));
    const saved = onSave.mock.calls[0]![0] as BoardTemplate;
    expect(saved.version).toBe(base.version + 1);
    expect(saved.fields.map((f) => f.key)).toContain("generator");
  });

  it("edits fields and configures layouts, position approvals, due rules, and escalations", () => {
    const base = STANDARD_TEMPLATES.find((template) => template.key === "shelters")!;
    const onSave = vi.fn();
    render(<Designer base={base} positions={[{ key: "planning_chief", title: "Planning Section Chief" }]}
      onSave={onSave} />);

    fireEvent.click(screen.getByText("Shelter"));
    setByLabel("name label", "Site name");
    fireEvent.click(screen.getByLabelText("name required"));

    fireEvent.click(screen.getByRole("tab", { name: "Views" }));
    fireEvent.click(screen.getByText("Operating shelters"));
    setByLabel("open view title", "Available shelters");
    setByLabel("open sort field", "capacity");

    fireEvent.click(screen.getByRole("tab", { name: "Layouts" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Add section" })[0]!);

    fireEvent.click(screen.getByRole("tab", { name: "Routing" }));
    fireEvent.click(screen.getByRole("button", { name: "Enable routing" }));
    fireEvent.click(screen.getByLabelText("Assign during this transition"));
    setByLabel("Due rule", "relative");
    setByLabel("Due after minutes", "90");
    fireEvent.click(screen.getByRole("button", { name: "Add approval" }));
    setByLabel("Approver", "position_key");
    expect((screen.getByLabelText("Approver position") as HTMLSelectElement).value).toBe("planning_chief");
    fireEvent.click(screen.getByRole("button", { name: "Add escalation" }));

    fireEvent.click(screen.getByText(`Publish version ${base.version + 1}`));
    const saved = onSave.mock.calls[0]![0] as BoardTemplate;
    expect(saved.fields.find((field) => field.key === "name")).toMatchObject({ label: "Site name", required: false });
    expect(saved.views[0]).toMatchObject({ title: "Available shelters", sort: { field: "capacity", dir: "asc" } });
    expect(saved.inputLayout?.sections[0]?.fields).toEqual(["name"]);
    expect(saved.workflow?.transitions[0]).toMatchObject({
      assignment: { required: true, allowedTargets: ["position"] },
      due: { kind: "relative", minutes: 90 },
      approvals: [{ approver: { kind: "position_key", positionKey: "planning_chief" } }],
      escalations: [{ afterMinutes: 60, maxOccurrences: 1 }],
    });
  });

  it("authors conditional, calculated, and record-reference fields with structured controls", () => {
    const base = STANDARD_TEMPLATES.find((template) => template.key === "shelters")!;
    const onSave = vi.fn();
    render(<Designer base={base} onSave={onSave} />);

    setByLabel("Field key", "available");
    setByLabel("Field label", "Available spaces");
    setByLabel("Field type", "number");
    fireEvent.click(screen.getByLabelText("Calculate from number fields"));
    fireEvent.click(screen.getByLabelText("Capacity"));
    fireEvent.click(screen.getByLabelText("Occupancy"));
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));

    setByLabel("Field key", "source_record");
    setByLabel("Field label", "Source record");
    setByLabel("Field type", "record_ref");
    setByLabel("Target template key", "shelters");
    setByLabel("Target label field", "name");
    fireEvent.click(screen.getByLabelText("Show only when a condition matches"));
    setByLabel("Condition field", "status");
    setByLabel("Condition value", "normal");
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));

    fireEvent.click(screen.getByText(`Publish version ${base.version + 1}`));
    expect(onSave, screen.queryByRole("alert")?.textContent ?? "valid template must publish").toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]![0] as BoardTemplate;
    expect(saved.fields.find((field) => field.key === "available")?.calculation).toEqual({
      op: "sum", inputs: ["capacity", "occupancy"],
    });
    expect(saved.fields.find((field) => field.key === "source_record")).toMatchObject({
      targetBoardKey: "shelters", labelField: "name",
      condition: { field: "status", op: "eq", value: "normal" },
    });
  });

  it("publishes the enumeration visibly selected by default", () => {
    const onSave = vi.fn();
    render(<Designer onSave={onSave} />);
    setByLabel("Board key", "field_conditions");
    setByLabel("Board title", "Field conditions");
    addField({ key: "condition", label: "Condition", type: "enum" });
    fireEvent.click(screen.getByRole("tab", { name: "Views" }));
    setByLabel("View key", "all");
    setByLabel("View title", "All conditions");
    fireEvent.click(screen.getByLabelText("condition"));
    fireEvent.click(screen.getByRole("button", { name: "Add view" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish version 1" }));
    const saved = onSave.mock.calls[0]![0] as BoardTemplate;
    expect(saved.fields[0]?.enumId).toBe(allEnums()[0]?.id);
  });

  it("keeps focus while editable layout and workflow keys change", () => {
    const base = STANDARD_TEMPLATES.find((template) => template.key === "shelters")!;
    render(<Designer base={base} onSave={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: "Layouts" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Add section" })[0]!);
    const sectionKey = screen.getByLabelText("Input layout section 1 key");
    sectionKey.focus();
    fireEvent.change(sectionKey, { target: { value: "intake" } });
    expect(document.activeElement).toBe(sectionKey);

    fireEvent.click(screen.getByRole("tab", { name: "Routing" }));
    fireEvent.click(screen.getByRole("button", { name: "Enable routing" }));
    const stateKey = screen.getByLabelText("State 1 key");
    stateKey.focus();
    fireEvent.change(stateKey, { target: { value: "opened" } });
    expect(document.activeElement).toBe(stateKey);
  });

  it("shows a publication failure while the review tab is selected", async () => {
    const base = STANDARD_TEMPLATES.find((template) => template.key === "shelters")!;
    render(<Designer base={base} onSave={async () => { throw new Error("Publication denied"); }} />);
    fireEvent.click(screen.getByRole("tab", { name: "Review & preview" }));
    fireEvent.click(screen.getByRole("button", { name: `Publish version ${base.version + 1}` }));
    expect((await screen.findByRole("alert")).textContent).toContain("Publication denied");
  });
});
