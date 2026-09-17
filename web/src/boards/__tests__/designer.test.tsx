// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardTemplateSchema, STANDARD_TEMPLATES, type BoardTemplate } from "@openeoc/shared";
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

    setByLabel("View key", "all");
    setByLabel("View title", "All shelters");
    fireEvent.click(screen.getByRole("group", { name: "View columns" }).querySelectorAll("input")[0]!);
    fireEvent.click(screen.getByRole("group", { name: "View columns" }).querySelectorAll("input")[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Add view" }));

    fireEvent.click(screen.getByText("Save as version 1"));
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
    fireEvent.click(screen.getByText("Save as version 1"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("editing an existing template shows the structural diff and bumps the version", () => {
    const base = STANDARD_TEMPLATES.find((t) => t.key === "shelters")!;
    const onSave = vi.fn();
    render(<Designer base={base} onSave={onSave} />);
    addField({ key: "generator", label: "Has generator" });
    expect(screen.getByTestId("diff").textContent).toContain("added: generator");
    fireEvent.click(screen.getByText(`Save as version ${base.version + 1}`));
    const saved = onSave.mock.calls[0]![0] as BoardTemplate;
    expect(saved.version).toBe(base.version + 1);
    expect(saved.fields.map((f) => f.key)).toContain("generator");
  });
});
