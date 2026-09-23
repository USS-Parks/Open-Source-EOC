import { describe, expect, it } from "vitest";
import type { FieldDef } from "../../boards/fields.js";
import { checkExpression, evaluate, evaluateBool, ExprError } from "../expr.js";
import { allFields, FormDefinitionSchema, importXlsForm, type XlsFormSheets } from "../xlsform.js";
import { choicesFor, formBoardData, geoAnswer, odkText, runForm, submission } from "../runner.js";

/**
 * Field depth: line and polygon capture, barcode, photo and audio questions,
 * cascading selects and repeats, from the XLSForm sheets through the runner's
 * validation to the board record payload.
 */

const survey: XlsFormSheets = {
  survey: [
    { type: "start", name: "started" },
    { type: "text", name: "summary", label: "Summary", required: "yes" },
    { type: "select_one counties", name: "county", label: "County", required: "yes" },
    { type: "select_one towns", name: "town", label: "Town", required: "yes", choice_filter: "county=${county}" },
    { type: "geotrace", name: "route", label: "Road segment" },
    { type: "geoshape", name: "area", label: "Affected area" },
    { type: "barcode", name: "asset_tag", label: "Asset tag" },
    { type: "image", name: "photo", label: "Photo" },
    { type: "audio", name: "voice_note", label: "Voice note" },
    { type: "begin_repeat", name: "crews", label: "Crew" },
    { type: "text", name: "crew_name", label: "Crew name", required: "yes" },
    { type: "integer", name: "crew_size", label: "Crew size", constraint: ". > 0", constraint_message: "at least one person" },
    { type: "end_repeat", name: "crews" },
  ],
  choices: [
    { list_name: "counties", name: "humboldt", label: "Humboldt" },
    { list_name: "counties", name: "del_norte", label: "Del Norte" },
    { list_name: "towns", name: "eureka", label: "Eureka", county: "humboldt" },
    { list_name: "towns", name: "arcata", label: "Arcata", county: "humboldt" },
    { list_name: "towns", name: "klamath", label: "Klamath", county: "del_norte" },
  ],
  settings: { form_title: "Field damage survey" },
};
const def = importXlsForm(survey, { key: "field_survey" });

const LINE = "40.80 -124.16;40.81 -124.17;40.82 -124.18";
const RING = "40.80 -124.16;40.81 -124.16;40.81 -124.17;40.80 -124.16";
const valid = {
  summary: "Culvert failure", county: "humboldt", town: "arcata", route: LINE, area: RING,
  asset_tag: "CUL-0042", photo: "file-token", voice_note: "audio-token",
  crews: [{ crew_name: "Engine 12", crew_size: 4 }, { crew_name: "Dozer 3", crew_size: 2 }],
};

describe("expression engine additions", () => {
  it("reads the current value as '.' and choice columns as bare names", () => {
    expect(evaluate(". >= 0", { ".": 3 })).toBe(true);
    expect(evaluate(".5 + 1", {})).toBe(1.5);
    expect(evaluateBool("county=${county}", { county: "humboldt" }, { county: "humboldt" })).toBe(true);
    expect(evaluateBool("county=${county}", { county: "humboldt" }, { county: "del_norte" })).toBe(false);
    expect(() => evaluate("county = 'x'", {})).toThrow(/outside a choice filter/);
  });

  it("refuses unsupported functions and stray names before anything runs", () => {
    expect(() => checkExpression("today() > 1")).toThrow(ExprError);
    expect(() => checkExpression("county = ${x}")).toThrow(/outside a choice filter/);
    expect(() => checkExpression("county = ${x}", true)).not.toThrow();
    expect(() => checkExpression("jr:choice-name(${x}, 'y')")).toThrow(ExprError);
  });
});

describe("XLSForm import of the field depth types", () => {
  it("reads line, polygon, barcode, photo, audio, cascading selects and an underscore repeat", () => {
    expect(def.title).toBe("Field damage survey");
    const types = Object.fromEntries(allFields(def.nodes).map((f) => [f.name, f.type]));
    expect(types).toMatchObject({
      route: "geotrace", area: "geoshape", asset_tag: "barcode", photo: "image", voice_note: "audio",
    });
    expect(types.started).toBeUndefined(); // metadata rows are skipped
    const town = allFields(def.nodes).find((f) => f.name === "town")!;
    expect(town.choiceFilter).toBe("county=${county}");
    expect(town.choices?.[0]).toEqual({ name: "eureka", label: "Eureka", properties: { county: "humboldt" } });
    const crews = def.nodes.find((n) => n.name === "crews")!;
    expect(crews.kind).toBe("repeat");
    expect(FormDefinitionSchema.parse(def)).toEqual(def);
  });

  it("refuses unsupported constructs with the survey row that carries them", () => {
    const one = (row: Record<string, string>, choices = survey.choices) =>
      () => importXlsForm({ survey: [row], choices }, { key: "x" });
    expect(one({ type: "range", name: "r" })).toThrow("survey row 2: question type 'range' is not supported");
    expect(one({ type: "select_one counties or_other", name: "c" })).toThrow(/or_other' is not supported/);
    expect(one({ type: "select_one missing", name: "c" })).toThrow(/choice list 'missing' is not on the choices sheet/);
    expect(one({ type: "text", name: "t", choice_filter: "a=1" })).toThrow(/choice_filter applies only to select/);
    expect(one({ type: "text", name: "t", relevant: "today() > 0" })).toThrow(/question 't' relevant: unsupported function 'today\(\)'/);
    expect(() => importXlsForm({ survey: [{ type: "begin_repeat", name: "r", repeat_count: "3" }, { type: "end_repeat" }], choices: [] }, { key: "x" }))
      .toThrow(/repeat_count is not supported/);
    expect(() => importXlsForm({ survey: [{ type: "begin group", name: "g" }, { type: "end repeat" }], choices: [] }, { key: "x" }))
      .toThrow(/end repeat closes the group 'g'/);
  });
});

describe("runner validation of the field depth types", () => {
  it("accepts a complete capture and nests the repeat entries in the submission", () => {
    expect(runForm(def, valid).errors).toEqual([]);
    expect(submission(def, valid).crews).toEqual(valid.crews);
  });

  it("offers only the choices the parent answer allows and refuses any other", () => {
    const town = allFields(def.nodes).find((f) => f.name === "town")!;
    expect(choicesFor(town, { county: "del_norte" }).map((c) => c.name)).toEqual(["klamath"]);
    expect(runForm(def, { ...valid, town: "klamath" }).errors)
      .toContainEqual({ field: "town", message: "not an allowed choice" });
    expect(runForm(def, { ...valid, county: "nowhere" }).errors)
      .toContainEqual({ field: "county", message: "not an allowed choice" });
  });

  it("requires a line of two points and a closed polygon of three distinct points", () => {
    const errors = (answers: Record<string, unknown>) => runForm(def, { ...valid, ...answers } as never).errors;
    expect(errors({ route: "40.8 -124.1" })).toContainEqual({ field: "route", message: "a line needs at least 2 points" });
    expect(errors({ route: "40.8 north" })).toContainEqual({ field: "route", message: expect.stringMatching(/latitude and longitude/) });
    expect(errors({ area: "40.80 -124.16;40.81 -124.16;40.81 -124.17" }))
      .toContainEqual({ field: "area", message: "a polygon must be closed: repeat the first point last" });
    expect(errors({ area: "40.80 -124.16;40.81 -124.16;40.80 -124.16" }))
      .toContainEqual({ field: "area", message: "a polygon needs at least 3 distinct points" });
    expect(errors({ area: "95 -124.16;40.81 -124.16;40.81 -124.17;95 -124.16" }))
      .toContainEqual({ field: "area", message: expect.stringMatching(/latitude and longitude/) });
    expect(geoAnswer("geoshape", RING)).toEqual({ geometry: { type: "Polygon", coordinates: [[
      [-124.16, 40.8], [-124.16, 40.81], [-124.17, 40.81], [-124.16, 40.8],
    ]] } });
    expect(odkText([[-124.16, 40.8], [-124.17, 40.81]])).toBe("40.8 -124.16;40.81 -124.17");
  });

  it("checks each repeat entry and refuses a repeat that is not a list of entries", () => {
    expect(runForm(def, { ...valid, crews: [{ crew_size: 0 }] }).errors).toEqual([
      { field: "crews[0].crew_name", message: "required" },
      { field: "crews[0].crew_size", message: "at least one person" },
    ]);
    expect(runForm(def, { ...valid, crews: "Engine 12" }).errors)
      .toContainEqual({ field: "crews", message: "must be a list of entries" });
    expect(runForm(def, { ...valid, asset_tag: 42 }).errors)
      .toContainEqual({ field: "asset_tag", message: "must be text" });
  });
});

describe("the board record payload", () => {
  const board: FieldDef[] = [
    { key: "summary", label: "Summary", type: "text", required: true, read: "any", write: "member" },
    { key: "town", label: "Town", type: "text", required: false, read: "any", write: "member" },
    { key: "location", label: "Location", type: "geometry", geometryKind: "point", required: false, read: "any", write: "member" },
    { key: "footprint", label: "Footprint", type: "geometry", geometryKind: "polygon", required: false, read: "any", write: "member" },
    { key: "route", label: "Route", type: "geometry", geometryKind: "linestring", required: false, read: "any", write: "member" },
    { key: "photo", label: "Photo", type: "attachment", required: false, read: "any", write: "member" },
    { key: "crews", label: "Crews", type: "text", required: false, read: "any", write: "member" },
  ];

  it("puts each geometry in a field of its kind and a repeat in a text field as JSON", () => {
    const data = formBoardData(def, board, valid);
    expect(data.route).toEqual({ type: "LineString", coordinates: [[-124.16, 40.8], [-124.17, 40.81], [-124.18, 40.82]] });
    expect(data.footprint).toMatchObject({ type: "Polygon" });
    expect(data.location).toBeUndefined(); // a polygon never lands in a point field
    expect(JSON.parse(data.crews as string)).toEqual(valid.crews);
    expect(data.photo).toBe("file-token");
    expect(data.town).toBe("arcata");
    expect(formBoardData(def, board, valid, { omitMedia: true }).photo).toBeUndefined();
  });
});
