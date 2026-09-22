import { evaluate, evaluateBool, type Bindings, type Scalar } from "./expr.js";
import type { FormDefinition, FormField, FormNode } from "./xlsform.js";

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
  /** Names of the fields currently relevant (visible), repeats excluded. */
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
      if (node.constraint && !isEmpty(value) && !evaluateBool(node.constraint, bindings)) {
        errors.push({
          field: `${prefix}${node.name}`,
          message: node.constraintMessage ?? "constraint violated",
        });
      }
    } else if (node.kind === "group") {
      walkScope(node.children, answers, visible, errors, prefix);
    } else {
      // repeat: each instance sees the enclosing scope's answers plus its own.
      const instances = Array.isArray(answers[node.name])
        ? (answers[node.name] as AnswerRecord[])
        : [];
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
      const instances = Array.isArray(answers[node.name])
        ? (answers[node.name] as AnswerRecord[])
        : [];
      out[node.name] = instances.map((instance) => {
        const merged: AnswerRecord = { ...answers, ...instance };
        const sub: AnswerRecord = {};
        collectSubmission(node.children, merged, bindingsOf(merged), sub);
        return sub;
      });
    }
  }
}
