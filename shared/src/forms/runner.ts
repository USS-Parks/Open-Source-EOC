import type { FieldDef, GeoJsonGeometry } from "../boards/fields.js";
import { evaluate, evaluateBool, type Bindings, type Scalar } from "./expr.js";
import type { Choice, FormContainer, FormDefinition, FormField, FormNode } from "./xlsform.js";

/**
 * Pure form runner (F7). Given a form and a set of answers it
 * resolves relevance, runs calculations to a fixed point, checks
 * constraints and required fields, and produces the submission. No I/O,
 * so the whole thing runs offline in the field client and is exhaustively
 * unit-tested against the source semantics.
 */

export type AnswerValue = Scalar | string[] | AnswerRecord[] | undefined;
export type AnswerRecord = Record<string, AnswerValue>;

export interface FieldError {
  readonly field: string;
  readonly message: string;
}

export interface RunResult {
  /** Answers after calculations, for every relevant field (repeats nested). */
  readonly values: AnswerRecord;
  /**
   * Paths of the questions, groups and repeats currently relevant (visible).
   * A question inside a repeat instance reads `repeat[0].question`.
   */
  readonly visible: readonly string[];
  readonly errors: readonly FieldError[];
}

const CALC_MAX_PASSES = 20;

function scalarize(v: AnswerValue): Scalar {
  if (v === undefined) return null;
  if (Array.isArray(v)) {
    // A select_multiple array binds as ODK's space-joined form.
    if (v.every((x) => typeof x === "string")) return (v as string[]).join(" ");
    return null; // repeat groups do not bind as a scalar
  }
  return v;
}

/** Scalar bindings for the expression engine from a flat answer record. */
function bindingsOf(answers: AnswerRecord): Bindings {
  const out: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(answers)) out[k] = scalarize(v);
  return out;
}

function isEmpty(v: AnswerValue): boolean {
  if (v === undefined || v === null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function isRecord(v: unknown): v is AnswerRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The choices a select offers given the answers in scope, after its choice_filter. */
export function choicesFor(field: FormField, scope: AnswerRecord): readonly Choice[] {
  const choices = field.choices ?? [];
  if (!field.choiceFilter) return choices;
  const bindings = bindingsOf(scope);
  return choices.filter((choice) =>
    evaluateBool(field.choiceFilter, bindings, { name: choice.name, label: choice.label, ...choice.properties }));
}

/** ODK "lat lon [alt [acc]]" points joined by ";", as GeoJSON [lon, lat]; null when any is malformed. */
export function odkPositions(value: unknown): Array<[number, number]> | null {
  if (typeof value !== "string") return null;
  const out: Array<[number, number]> = [];
  for (const part of value.split(";")) {
    if (!part.trim()) continue; // ODK writes a trailing separator
    const numbers = part.trim().split(/\s+/).map(Number);
    if (numbers.length < 2 || numbers.length > 4 || numbers.some((n) => !Number.isFinite(n))) return null;
    const [lat, lon] = numbers as [number, number];
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    out.push([lon, lat]);
  }
  return out.length ? out : null;
}

/** GeoJSON [lon, lat] positions in ODK's "lat lon;lat lon" answer form. */
export function odkText(positions: ReadonlyArray<readonly [number, number]>): string {
  return positions.map(([lon, lat]) => `${lat} ${lon}`).join(";");
}

export type GeoQuestionType = "geopoint" | "geotrace" | "geoshape";

/**
 * A location, line or polygon answer as GeoJSON, or why it is not one. A
 * line needs two points; a polygon needs three distinct points and a closed
 * ring, its first point repeated last, as ODK records it.
 */
export function geoAnswer(
  type: GeoQuestionType,
  value: unknown,
): { geometry: GeoJsonGeometry } | { error: string } {
  const points = odkPositions(value);
  if (!points) return { error: "enter latitude and longitude pairs separated by semicolons" };
  if (type === "geopoint") {
    return points.length === 1 ? { geometry: { type: "Point", coordinates: points[0]! } } : { error: "a location is one point" };
  }
  if (type === "geotrace") {
    return points.length >= 2 ? { geometry: { type: "LineString", coordinates: points } } : { error: "a line needs at least 2 points" };
  }
  if (new Set(points.map((point) => point.join(" "))).size < 3) return { error: "a polygon needs at least 3 distinct points" };
  const [first, last] = [points[0]!, points[points.length - 1]!];
  if (first[0] !== last[0] || first[1] !== last[1]) return { error: "a polygon must be closed: repeat the first point last" };
  return { geometry: { type: "Polygon", coordinates: [points] } };
}

const GEO_TYPES: ReadonlySet<string> = new Set(["geopoint", "geotrace", "geoshape"]);
export const MEDIA_QUESTION_TYPES: ReadonlySet<string> = new Set(["image", "audio"]);

/** Why an answered value does not fit its question, or null when it does. */
function valueProblem(field: FormField, value: AnswerValue, scope: AnswerRecord): string | null {
  switch (field.type) {
    case "select_one":
    case "select_multiple": {
      const picked = field.type === "select_one" ? [value] : Array.isArray(value) ? value : [value];
      if (!picked.every((item) => typeof item === "string")) return "not an allowed choice";
      if (!field.choices) return null;
      const allowed = new Set(choicesFor(field, scope).map((choice) => choice.name));
      return (picked as string[]).every((item) => allowed.has(item)) ? null : "not an allowed choice";
    }
    case "geopoint":
    case "geotrace":
    case "geoshape": {
      const geo = geoAnswer(field.type, value);
      return "error" in geo ? geo.error : null;
    }
    case "barcode":
    case "image":
    case "audio":
      return typeof value === "string" ? null : "must be text";
    default:
      return null;
  }
}

/**
 * Run calculations to a fixed point over one scope's answers. Repeats
 * are handled by their own scope, so this only touches scalar fields.
 */
function applyCalculations(fields: FormField[], answers: AnswerRecord): void {
  for (let pass = 0; pass < CALC_MAX_PASSES; pass++) {
    let changed = false;
    const bindings = bindingsOf(answers);
    for (const field of fields) {
      if (!field.calculation) continue;
      if (!evaluateBool(field.relevant, bindings)) continue;
      const next = evaluate(field.calculation, bindings);
      if (scalarize(answers[field.name]) !== next) {
        answers[field.name] = next;
        changed = true;
      }
    }
    if (!changed) return;
  }
}

/**
 * Walk one scope (top level or a single repeat instance), collecting
 * visible field names and errors. Ancestor-relevance gating is applied
 * by only descending into relevant containers.
 */
function walkScope(
  nodes: readonly FormNode[],
  answers: AnswerRecord,
  visible: string[],
  errors: FieldError[],
  prefix: string,
): void {
  const bindings = bindingsOf(answers);
  for (const node of nodes) {
    if (!evaluateBool(node.relevant, bindings)) continue;
    if (node.kind === "field") {
      if (node.type === "note") continue;
      visible.push(`${prefix}${node.name}`);
      const value = answers[node.name];
      if (node.required && isEmpty(value)) {
        errors.push({ field: `${prefix}${node.name}`, message: "required" });
        continue;
      }
      if (isEmpty(value)) continue;
      const problem = valueProblem(node, value, answers);
      if (problem) {
        errors.push({ field: `${prefix}${node.name}`, message: problem });
        continue;
      }
      if (node.constraint && !evaluateBool(node.constraint, { ...bindings, ".": scalarize(value) })) {
        errors.push({
          field: `${prefix}${node.name}`,
          message: node.constraintMessage ?? "constraint violated",
        });
      }
    } else if (node.kind === "group") {
      visible.push(`${prefix}${node.name}`);
      walkScope(node.children, answers, visible, errors, prefix);
    } else {
      visible.push(`${prefix}${node.name}`);
      // repeat: each instance sees the enclosing scope's answers plus its own.
      const raw = answers[node.name];
      if (raw !== undefined && !(Array.isArray(raw) && raw.every(isRecord))) {
        errors.push({ field: `${prefix}${node.name}`, message: "must be a list of entries" });
        continue;
      }
      const instances = (raw ?? []) as AnswerRecord[];
      instances.forEach((instance, i) => {
        const merged: AnswerRecord = { ...answers, ...instance };
        const subFields = repeatFields(node.children);
        applyCalculations(subFields, merged);
        for (const f of subFields) instance[f.name] = merged[f.name];
        walkScope(node.children, merged, visible, errors, `${prefix}${node.name}[${i}].`);
      });
    }
  }
}

function repeatFields(nodes: readonly FormNode[]): FormField[] {
  const out: FormField[] = [];
  for (const n of nodes) {
    if (n.kind === "field") out.push(n);
    else out.push(...repeatFields(n.children));
  }
  return out;
}

function topLevelFields(nodes: readonly FormNode[]): FormField[] {
  const out: FormField[] = [];
  for (const n of nodes) {
    if (n.kind === "field") out.push(n);
    else if (n.kind === "group") out.push(...topLevelFields(n.children));
    // repeats own their own calculation scope; not flattened here
  }
  return out;
}

/** JSON deep clone; answers are JSON-shaped (scalars, arrays, records). */
function clone(answers: AnswerRecord): AnswerRecord {
  return JSON.parse(JSON.stringify(answers)) as AnswerRecord;
}

export function runForm(def: FormDefinition, rawAnswers: AnswerRecord): RunResult {
  const answers: AnswerRecord = clone(rawAnswers);
  applyCalculations(topLevelFields(def.nodes), answers);
  const visible: string[] = [];
  const errors: FieldError[] = [];
  walkScope(def.nodes, answers, visible, errors, "");
  return { values: answers, visible, errors };
}

/**
 * The submission: relevant, non-note field values (calculations included),
 * with repeat instances nested. Irrelevant answers are dropped, matching
 * ODK's "relevant-only" persistence.
 */
export function submission(def: FormDefinition, rawAnswers: AnswerRecord): AnswerRecord {
  const { values } = runForm(def, rawAnswers);
  const bindings = bindingsOf(values);
  const out: AnswerRecord = {};
  collectSubmission(def.nodes, values, bindings, out);
  return out;
}

function collectSubmission(
  nodes: readonly FormNode[],
  answers: AnswerRecord,
  bindings: Bindings,
  out: AnswerRecord,
): void {
  for (const node of nodes) {
    if (!evaluateBool(node.relevant, bindings)) continue;
    if (node.kind === "field") {
      if (node.type !== "note" && !isEmpty(answers[node.name])) {
        out[node.name] = answers[node.name];
      }
    } else if (node.kind === "group") {
      collectSubmission(node.children, answers, bindings, out);
    } else {
      const raw = answers[node.name];
      const instances = Array.isArray(raw) ? raw.filter(isRecord) : [];
      out[node.name] = instances.map((instance) => {
        const merged: AnswerRecord = { ...answers, ...instance };
        const sub: AnswerRecord = {};
        collectSubmission(node.children, merged, bindingsOf(merged), sub);
        return sub;
      });
    }
  }
}

/** The questions and repeats of the top scope, groups flattened. */
function scopeNodes(nodes: readonly FormNode[]): Array<FormField | FormContainer> {
  return nodes.flatMap((node) => node.kind === "group" ? scopeNodes(node.children) : [node]);
}

const GEOMETRY_KIND: Readonly<Record<GeoJsonGeometry["type"], string>> = {
  Point: "point", LineString: "linestring", Polygon: "polygon",
};

/**
 * A submission as a board record payload, the one mapping the server form
 * service and the offline field queue share. Answers map to board fields by
 * name. A location, line or polygon answer becomes GeoJSON in the geometry
 * field of the same name, else in the first unfilled geometry field whose
 * kind accepts it. A repeat maps to a text field of its name as a JSON array
 * of its entries, one record per submission. `omitMedia` leaves photo and
 * audio answers out for callers that attach the files after the record exists.
 */
export function formBoardData(
  def: FormDefinition,
  boardFields: readonly FieldDef[],
  answers: AnswerRecord,
  options: { readonly omitMedia?: boolean } = {},
): Record<string, unknown> {
  const values = submission(def, answers);
  const byKey = new Map(boardFields.map((field) => [field.key, field]));
  const geometryFields = boardFields.filter((field) => field.type === "geometry");
  const data: Record<string, unknown> = {};
  for (const node of scopeNodes(def.nodes)) {
    const value = values[node.name];
    if (value === undefined) continue;
    if (node.kind !== "field") {
      if (byKey.get(node.name)?.type === "text") data[node.name] = JSON.stringify(value);
    } else if (GEO_TYPES.has(node.type)) {
      const geo = geoAnswer(node.type as GeoQuestionType, value);
      if ("error" in geo) continue;
      const accepts = (field: FieldDef) => data[field.key] === undefined
        && [undefined, "any", GEOMETRY_KIND[geo.geometry.type]].includes(field.geometryKind);
      const target = geometryFields.find((field) => field.key === node.name && accepts(field))
        ?? geometryFields.find(accepts);
      if (target) data[target.key] = geo.geometry;
    } else if (!(options.omitMedia && MEDIA_QUESTION_TYPES.has(node.type)) && byKey.has(node.name)) {
      data[node.name] = value;
    }
  }
  return data;
}
