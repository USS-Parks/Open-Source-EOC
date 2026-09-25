// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allEnums,
  BoardTemplateSchema,
  STANDARD_DASHBOARDS,
  STANDARD_TEMPLATES,
  type BoardTemplate,
} from "@openeoc/shared";
import { ApiError, type ApiClient } from "../../app/api/client.js";
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

  it("gives the configuration and preview tabs the panel each one names", () => {
    render(<Designer base={STANDARD_TEMPLATES.find((t) => t.key === "shelters")!} onSave={() => undefined} />);
    const expectPanel = (name: string) => {
      const tab = screen.getByRole("tab", { name });
      const panel = document.getElementById(tab.getAttribute("aria-controls")!);
      expect(panel?.getAttribute("role")).toBe("tabpanel");
      expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
    };
    expectPanel("Fields");
    fireEvent.click(screen.getByRole("tab", { name: "Review & preview" }));
    expectPanel("Review & preview");
    expectPanel("Input");
    fireEvent.click(screen.getByRole("tab", { name: "Detail" }));
    expectPanel("Detail");
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
    fireEvent.click(screen.getAllByRole("button", { name: "Add sort key" })[0]!);
    setByLabel("Sort 1 field", "capacity");
    fireEvent.click(screen.getAllByRole("button", { name: "Save to view" })[0]!);

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
    expect(saved.views[0]).toMatchObject({ title: "Available shelters", sorts: [{ field: "capacity", dir: "asc" }] });
    expect(saved.views[0]).not.toHaveProperty("sort");
    expect(saved.inputLayout?.sections[0]?.fields).toEqual(["name"]);
    expect(saved.workflow?.transitions[0]).toMatchObject({
      assignment: { required: true, allowedTargets: ["position"] },
      due: { kind: "relative", minutes: 90 },
      approvals: [{ approver: { kind: "position_key", positionKey: "planning_chief" } }],
      escalations: [{ afterMinutes: 60, maxOccurrences: 1 }],
    });
  });

  it("guards a transition with conditions on the record and locks fields in a state", () => {
    const base = STANDARD_TEMPLATES.find((template) => template.key === "shelters")!;
    const onSave = vi.fn();
    render(<Designer base={base} positions={[]} onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "Routing" }));
    fireEvent.click(screen.getByRole("button", { name: "Enable routing" }));
    const complete = screen.getByRole("group", { name: "Read-only while Complete" });
    const capacity = base.fields.find((field) => field.key === "capacity")!;
    fireEvent.click(within(complete).getByLabelText(capacity.label));
    const guard = screen.getByRole("group", { name: "Guard for transition 1" });
    fireEvent.click(within(guard).getByLabelText("Guard this transition with conditions on the record"));
    fireEvent.change(within(guard).getByLabelText("Condition 1 field"), { target: { value: "capacity" } });
    fireEvent.change(within(guard).getByLabelText("Condition 1 operator"), { target: { value: "gt" } });
    expect(within(guard).getByRole("status").textContent).toBe("Condition 1 is left out of the guard until its value is complete.");
    fireEvent.change(within(guard).getByLabelText("Condition 1 value"), { target: { value: "0" } });
    expect(within(guard).queryByRole("status")).toBeNull();
    fireEvent.change(within(guard).getByLabelText("Said when the guard refuses (optional)"), { target: { value: "Enter the shelter's capacity first." } });
    fireEvent.click(screen.getByText(`Publish version ${base.version + 1}`));
    const saved = onSave.mock.calls[0]![0] as BoardTemplate;
    expect(saved.workflow?.states.find((state) => state.key === "complete")?.readOnlyFields).toEqual(["capacity"]);
    expect(saved.workflow?.states.find((state) => state.key === "new")).not.toHaveProperty("readOnlyFields");
    expect(saved.workflow?.transitions[0]?.guard).toEqual({
      match: "all", conditions: [{ field: "capacity", op: "gt", value: 0 }], message: "Enter the shelter's capacity first.",
    });
    expect(BoardTemplateSchema.safeParse(saved).success).toBe(true);
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
    setByLabel("Target label fields", "name");
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

  it("composes reference labels from several target fields, new and existing", () => {
    const base = STANDARD_TEMPLATES.find((template) => template.key === "shelters")!;
    const onSave = vi.fn();
    render(<Designer base={base} onSave={onSave} />);
    setByLabel("Field key", "host_site");
    setByLabel("Field label", "Host site");
    setByLabel("Field type", "record_ref");
    setByLabel("Target template key", "shelters");
    setByLabel("Target label fields", "name, status,");
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    expect((screen.getByLabelText("Target label fields") as HTMLInputElement).value).toBe("");

    fireEvent.click(screen.getByText("Host site"));
    setByLabel("host_site label fields", "name, status, capacity, occupancy");
    fireEvent.click(screen.getByText(`Publish version ${base.version + 1}`));
    const saved = onSave.mock.calls[0]![0] as BoardTemplate;
    const field = saved.fields.find((item) => item.key === "host_site")!;
    expect(field.labelFields).toEqual(["name", "status", "capacity", "occupancy"]);
    expect(field.labelField).toBeUndefined();
  });

  it("grants record access with plain labels and refuses an empty read list", () => {
    const base = STANDARD_TEMPLATES.find((template) => template.key === "shelters")!;
    const onSave = vi.fn();
    render(<Designer base={base} onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "Record access" }));
    fireEvent.click(screen.getByRole("button", { name: "Restrict individual records" }));
    expect(screen.getAllByText(/Anyone assigned to the position the record was created under/)).toHaveLength(2);
    expect((screen.getByLabelText("Read: The assigned position") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByLabelText("Edit: Board viewers")).toBeNull();

    fireEvent.click(screen.getByLabelText("Read: The record's creator"));
    fireEvent.click(screen.getByLabelText("Read: The creator's position"));
    expect(screen.getByRole("note").textContent).toMatch(/Writers lose sight/);
    fireEvent.click(screen.getByText(`Publish version ${base.version + 1}`));
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Record access" }));
    fireEvent.click(screen.getByLabelText("Read: The record's creator"));
    fireEvent.click(screen.getByLabelText("Read: Board viewers"));
    fireEvent.click(screen.getByLabelText("Edit: Board members"));
    fireEvent.click(screen.getByText(`Publish version ${base.version + 1}`));
    const saved = onSave.mock.calls[0]![0] as BoardTemplate;
    expect(saved.recordAccess).toEqual({
      read: [{ kind: "role", roles: ["viewer"] }, { kind: "creator" }],
      edit: [{ kind: "role", roles: ["member"] }, { kind: "creator" }, { kind: "creator_position" }],
    });
  });

  it("adds a local field to the board being customized", async () => {
    const shelters = STANDARD_TEMPLATES.find((template) => template.key === "shelters")!;
    const getBoard = vi.fn()
      .mockResolvedValueOnce({ fields: shelters.fields })
      .mockResolvedValue({ fields: [...shelters.fields, { key: "x_generator", label: "Generator", type: "boolean" }] });
    const client = {
      getBoard,
      addLocalField: vi.fn()
        .mockRejectedValueOnce(new ApiError(409, "field key already exists on this board"))
        .mockResolvedValue({ ok: true }),
    } as unknown as ApiClient;
    render(<Designer base={shelters} onSave={() => undefined} client={client} jurisdictionId="j-1" boardId="board-1" />);
    fireEvent.click(screen.getByRole("tab", { name: "Local fields" }));
    await screen.findByText("This board has no local fields.");
    setByLabel("Local field key", "generator");
    setByLabel("Local field label", "Generator");
    setByLabel("Local field type", "boolean");
    expect(screen.getByText("x_generator")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add local field" }));
    expect((await screen.findByRole("alert")).textContent).toBe("field key already exists on this board");
    fireEvent.click(screen.getByRole("button", { name: "Add local field" }));
    await screen.findByText("Added x_generator to this board.");
    expect(client.addLocalField).toHaveBeenLastCalledWith("board-1", {
      key: "x_generator", label: "Generator", type: "boolean", required: false, read: "any", write: "member",
    });
    expect(await screen.findByRole("list", { name: "Local fields on this board" })).toBeTruthy();
    expect(getBoard).toHaveBeenCalledWith("board-1");
  });

  it("shows a publication failure while the review tab is selected", async () => {
    const base = STANDARD_TEMPLATES.find((template) => template.key === "shelters")!;
    render(<Designer base={base} onSave={async () => { throw new Error("Publication denied"); }} />);
    fireEvent.click(screen.getByRole("tab", { name: "Review & preview" }));
    fireEvent.click(screen.getByRole("button", { name: `Publish version ${base.version + 1}` }));
    expect((await screen.findByRole("alert")).textContent).toContain("Publication denied");
  });
});

describe("definition import from the designer", () => {
  function importClient(overrides: Partial<Record<keyof ApiClient, unknown>> = {}) {
    return {
      publishTemplate: vi.fn().mockResolvedValue({ key: "generator_log", version: 1 }),
      importTemplatePackage: vi.fn().mockResolvedValue(2),
      importForm: vi.fn().mockResolvedValue({ key: "damage_intake", version: 1 }),
      importXlsForm: vi.fn().mockResolvedValue({ key: "road_closure_2", version: 1 }),
      importDashboardTemplate: vi.fn().mockResolvedValue({ key: "ops_overview", version: 1 }),
      listSolutionPackages: vi.fn().mockResolvedValue([]),
      ...overrides,
    } as unknown as ApiClient;
  }
  function choose(label: string, file: File) {
    fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
  }
  const json = (name: string, value: unknown) => new File([JSON.stringify(value)], name, { type: "application/json" });
  const openImport = (client: ApiClient) => {
    render(<Designer onSave={() => undefined} client={client} jurisdictionId="j-1" />);
    fireEvent.click(screen.getByRole("tab", { name: "Import" }));
  };

  it("imports a board template, a signed package, a form and a dashboard template and lists them", async () => {
    const client = importClient();
    openImport(client);
    const template = { ...STANDARD_TEMPLATES.find((item) => item.key === "shelters")!, key: "generator_log", version: 1 };
    choose("Board template file", json("generator-log.json", template));
    await screen.findByText("Board template Shelters (generator_log), version 1");
    expect(client.publishTemplate).toHaveBeenCalledWith(BoardTemplateSchema.parse(template));

    const pkg = { format: "openeoc-templates-v1", publisher: "Region", templates: [template] };
    choose("Board template file", json("region.json", pkg));
    await screen.findByText("Template package region.json, 2 new versions");
    expect(client.importTemplatePackage).toHaveBeenCalledWith(pkg);

    const workbook = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff])], "Road Closure 2.xlsx");
    choose("Form file", workbook);
    await screen.findByText("Form road_closure_2, version 1");
    expect(client.importXlsForm).toHaveBeenCalledWith("j-1", { key: "road_closure_2", xlsxBase64: "UEsDBP8=" });

    const form = { key: "damage_intake", version: 1, title: "Damage intake",
      nodes: [{ kind: "field", name: "summary", type: "text", label: "Summary" }] };
    choose("Form file", json("damage.json", form));
    await screen.findByText("Form Damage intake (damage_intake), version 1");

    const dashboard = { ...STANDARD_DASHBOARDS[0]!, key: "ops_overview", version: 1 };
    choose("Dashboard template file", json("ops.json", dashboard));
    await screen.findByText(`Dashboard template ${dashboard.title} (ops_overview), version 1`);
    expect(screen.getByRole("list", { name: "Imported definitions" }).children).toHaveLength(5);
  });

  it("names the fields of a malformed file and shows the server's refusal plainly", async () => {
    const client = importClient({
      importDashboardTemplate: vi.fn().mockRejectedValue(new ApiError(409, "dashboard template version already exists")),
    });
    openImport(client);
    choose("Board template file", json("broken.json", { key: "Bad Key", version: 1 }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/^broken\.json: .*title/);
    expect(client.publishTemplate).not.toHaveBeenCalled();

    choose("Form file", new File(["{ not json"], "form.json"));
    expect((await screen.findByRole("alert")).textContent).toBe("form.json: the file is not valid JSON.");

    choose("Dashboard template file", json("ops.json", STANDARD_DASHBOARDS[0]));
    expect((await screen.findByText(/already exists/)).textContent)
      .toBe("ops.json: dashboard template version already exists");
  });

  it("imports a signed solution package into the selected jurisdiction and says what it created, held and kept (VA11)", async () => {
    const empty = { created: [], held: [], kept: [] };
    const importSolutionPackage = vi.fn().mockResolvedValue({
      id: "p-1", publisher: "Klamath River Region", name: "Tribal EOC starter", version: "2026.1",
      publishedAt: "2026-09-25T20:00:00.000Z", keyFingerprint: "ab".repeat(32),
      parts: {
        boardTemplates: { ...empty, created: ["tribal_shelter_log version 1"] },
        incidentTemplates: { ...empty, kept: ["tribal_flood"] },
        forms: { ...empty, held: ["shelter_count version 1"] },
        dashboardTemplates: empty,
        reportTemplates: { ...empty, created: ["shelter_daily version 1"] },
        ruleTemplates: empty,
      },
    });
    // The instance's record of signed packages is read when the tab opens and again after each package.
    const listSolutionPackages = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([{
      id: "p-1", publisher: "Klamath River Region", name: "Tribal EOC starter", version: "2026.1", publishedAt: "2026-09-25T20:00:00.000Z",
      keyFingerprint: "ab".repeat(32), importedAt: "2026-09-25T21:00:00.000Z", importedBy: "Admin",
      parts: {},
    }]);
    const client = importClient({ importSolutionPackage, listSolutionPackages });
    openImport(client);
    const pkg = { format: "openeoc-package-v2", publisher: "Klamath River Region", contents: {}, signature: "s" };
    choose("Signed solution package", json("starter.json", pkg));
    const line = await screen.findByText(/^Package Tribal EOC starter 2026\.1/);
    expect(line.textContent).toBe(`Package Tribal EOC starter 2026.1 from Klamath River Region, signed with key ${"ab".repeat(8)}. `
      + "Created board templates tribal_shelter_log version 1; report templates shelter_daily version 1. "
      + "1 item was already here. Kept this instance's own incident template tribal_flood; edit it to take the package's.");
    expect(importSolutionPackage).toHaveBeenCalledWith("j-1", pkg);
    const onInstance = await screen.findByRole("list", { name: "Signed packages on this instance" });
    expect(onInstance.textContent).toMatch(new RegExp(`^Tribal EOC starter 2026\\.1 from Klamath River Region, key ${"ab".repeat(8)}: imported .+ by Admin$`));

    // A package dropped on the board template picker goes the same way; any other file is refused here.
    choose("Board template file", json("starter-again.json", pkg));
    await waitFor(() => expect(importSolutionPackage).toHaveBeenCalledTimes(2));
    choose("Signed solution package", json("template.json", { key: "generator_log", version: 1 }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("template.json: the file is not a signed solution package (format openeoc-package-v2).");
  });
});
