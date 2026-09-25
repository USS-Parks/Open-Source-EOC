import { describe, expect, it } from "vitest";
import {
  ICS_COMPONENT_FORMS,
  ICS_COMPONENT_FORM_IDS,
  componentFormLabel,
  componentToFormContent,
  emptyValue,
  isComponentFormId,
  prefillComponent,
  validateComponentValues,
} from "../components.js";
import { formToTextLines, type IncidentContext } from "../forms.js";
import { renderIcsFormPdf } from "../pdf.js";

/**
 * ICS forms as components (Veoci and air gap VA37). Each form's fields follow
 * the Forms Booklet blocks; a component's values are checked against its
 * form, prefilled from the incident's records, and printed in block order.
 */

const ctx: IncidentContext = {
  incidentName: "Klamath River Flood",
  operationalPeriod: "OP 2 (0600-1800)",
  preparedBy: "Rosa Planner",
  objectives: ["Keep Highway 96 open", "Shelter evacuees at the school gym"],
  org: [
    { section: "command", positionKey: "incident_commander", positionTitle: "Incident Commander", holder: "A. Rivers" },
    { section: "operations", positionKey: "operations_section_chief", positionTitle: "Operations Section Chief", holder: "B. Stone" },
    { section: "planning", positionKey: "planning_section_chief", positionTitle: "Planning Section Chief", holder: null },
    { section: "finance_admin", positionKey: "finance_admin_section_chief", positionTitle: "Finance/Administration Section Chief", holder: "C. Lee" },
  ],
  activityLog: [{ time: "0605", entry: "Assumed command" }, { time: "0630", entry: "Set objectives" }],
  checkIns: [{ name: "Engine 21", time: "0555" }],
  comms: [{ channel: "CMD-1", frequency: "154.2800", assignment: "Command" }],
  resources: [{ item: "Swift-water team", quantity: "2", state: "assigned" }],
  safetyMessage: "Stay off the levee crown.",
  medicalFacilities: ["Mad River Community Hospital"],
};

describe("ICS form components", () => {
  it("defines each form after its booklet blocks, with fields a value can be checked against", () => {
    expect(Object.keys(ICS_COMPONENT_FORMS)).toEqual([...ICS_COMPONENT_FORM_IDS]);
    for (const id of ICS_COMPONENT_FORM_IDS) {
      const form = ICS_COMPONENT_FORMS[id];
      expect(form.id).toBe(id);
      const keys = form.fields.map((field) => field.key);
      expect(new Set(keys).size, id).toBe(keys.length);
      expect(form.many, id).toBe(form.labelHint !== undefined);
      for (const field of form.fields) {
        expect(field.block, `${id} ${field.key}`).toMatch(/^\d+[a-z]?$/);
        if (field.kind === "choice" || field.kind === "checks") expect(field.options?.length).toBeGreaterThan(0);
        if (field.kind === "table") {
          expect(field.columns?.length).toBeGreaterThan(0);
          for (const row of field.rows ?? []) expect(row).toHaveLength(field.columns!.length);
        }
      }
    }
    expect(ICS_COMPONENT_FORM_IDS.filter((id) => ICS_COMPONENT_FORMS[id].many)).toEqual(["ICS-204", "ICS-213", "ICS-214"]);
    expect(componentFormLabel("ICS-205A")).toBe("ICS 205A: Communications List");
    expect(isComponentFormId("ICS-215A")).toBe(true);
    expect(isComponentFormId("ICS-999")).toBe(false);
  });

  it("fills a field left out with its empty value, and refuses what the form does not hold", () => {
    const values = validateComponentValues("ICS-208", { message: "Stay off the levee crown." });
    expect(values).toEqual({ message: "Stay off the levee crown.", siteSafetyPlanRequired: "", siteSafetyPlanLocation: "" });
    expect(validateComponentValues("ICS-209", {}).publicStatus).toHaveLength(10);
    expect(() => validateComponentValues("ICS-208", { note: "x" })).toThrow();
    expect(() => validateComponentValues("ICS-208", { siteSafetyPlanRequired: "Maybe" })).toThrow();
    expect(() => validateComponentValues("ICS-205", { channels: [["one", "two"]] })).toThrow();
    expect(() => validateComponentValues("ICS-202", { attachments: ["ICS 203", "ICS 203"] })).toThrow();
    expect(() => validateComponentValues("ICS-202", { attachments: ["ICS 299"] })).toThrow();
    expect(() => validateComponentValues("ICS-213", { message: "x".repeat(20_001) })).toThrow();
    expect(emptyValue(ICS_COMPONENT_FORMS["ICS-204"].fields.find((f) => f.key === "personnel")!)).toHaveLength(4);
  });

  it("prefills every form from the incident's records, and every prefill is a valid value", () => {
    for (const id of ICS_COMPONENT_FORM_IDS) {
      const values = prefillComponent(id, ctx, { preparedRole: "Planning Section Chief", incidentStart: "2026-09-25 06:00 UTC" });
      expect(validateComponentValues(id, values), id).toEqual(values);
    }
    const prefill = (id: Parameters<typeof prefillComponent>[0]) =>
      prefillComponent(id, ctx, { preparedRole: "Planning Section Chief", incidentStart: "2026-09-25 06:00 UTC" });
    expect(prefill("ICS-201")).toMatchObject({
      initiated: "2026-09-25 06:00 UTC",
      objectives: "Keep Highway 96 open\nShelter evacuees at the school gym",
      resources: [["Swift-water team", "", "", "", "", "Quantity 2; assigned"]],
    });
    expect(prefill("ICS-203")).toMatchObject({
      command: [["Incident Commander", "A. Rivers"]],
      planning: [["Planning Section Chief", ""]],
      finance: [["Finance/Administration Section Chief", "C. Lee"]],
      logistics: [],
    });
    expect((prefill("ICS-204").personnel as string[][])[0]).toEqual(["Operations Section Chief", "B. Stone", ""]);
    expect(prefill("ICS-205").channels).toEqual([["", "", "", "CMD-1", "Command", "154.2800", "", "154.2800", "", "", ""]]);
    expect(prefill("ICS-206").hospitals).toEqual([["Mad River Community Hospital", "", "", "", "", "", "", ""]]);
    expect(prefill("ICS-207").chart).toContainEqual(["Finance/Administration", "Finance/Administration Section Chief", "C. Lee"]);
    expect(prefill("ICS-208").message).toBe("Stay off the levee crown.");
    expect(prefill("ICS-211").checkIns).toEqual([["Engine 21", "", "", "", "0555", "", "", "", "", ""]]);
    expect(prefill("ICS-213").from).toBe("Rosa Planner, Planning Section Chief");
    expect(prefill("ICS-214")).toMatchObject({
      name: "Rosa Planner", position: "Planning Section Chief", activity: [["0605", "Assumed command"], ["0630", "Set objectives"]],
    });
  });

  it("prints a component in block order: checks marked, tables with their columns, long text by line", () => {
    const values = validateComponentValues("ICS-202", {
      objectives: "Keep Highway 96 open\nShelter evacuees",
      siteSafetyPlanRequired: "No",
      attachments: ["ICS 203", "ICS 208"],
    });
    const form = componentToFormContent("ICS-202", values, {
      incidentName: "Klamath River Flood", operationalPeriod: "OP 2", preparedBy: "Rosa Planner, Planning Section Chief",
    });
    expect(form).toMatchObject({ id: "ICS-202", title: "Incident Objectives", preparedBy: "Rosa Planner, Planning Section Chief" });
    const lines = formToTextLines(form);
    expect(lines.slice(0, 4)).toEqual(["ICS-202 Incident Objectives", "  3. Objective(s)", "    Keep Highway 96 open", "    Shelter evacuees"]);
    expect(lines).toContain("    [X] ICS 203");
    expect(lines).toContain("    [ ] ICS 204");
    expect(lines).toContain("  5. Site Safety Plan Required?");
    const assignment = componentToFormContent("ICS-204", validateComponentValues("ICS-204", {}), {
      incidentName: "Klamath River Flood", operationalPeriod: "OP 2", preparedBy: "Rosa Planner", label: "Division A",
    });
    expect(assignment.title).toBe("Assignment List: Division A");
    expect(assignment.sections.find((s) => s.heading === "4. Operations Personnel")?.columns).toEqual(["Position", "Name", "Contact Number(s)"]);

    const pdf = Array.from(renderIcsFormPdf(form, { revision: "Version 3; ready" }), (b) => String.fromCharCode(b)).join("");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("(ICS 202 Incident Objectives: Klamath River Flood) Tj");
    expect(pdf).toContain("(Revision: Version 3; ready) Tj");
    expect(pdf).toContain("(Prepared by: Rosa Planner, Planning Section Chief) Tj");
    expect(renderIcsFormPdf(form)).toEqual(renderIcsFormPdf(form));
  });
});
