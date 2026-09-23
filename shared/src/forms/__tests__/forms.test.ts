import { describe, expect, it } from "vitest";
import { evaluate, evaluateBool, ExprError } from "../expr.js";
import { importXlsForm, allFields, type XlsFormSheets } from "../xlsform.js";
import { runForm, submission, type AnswerRecord } from "../runner.js";

describe("XLSForm expression engine (conformance)", () => {
  it("evaluates arithmetic with div and mod, honoring precedence", () => {
    expect(evaluate("2 + 3 * 4", {})).toBe(14);
    expect(evaluate("(2 + 3) * 4", {})).toBe(20);
    expect(evaluate("17 div 5", {})).toBe(3.4);
    expect(evaluate("17 mod 5", {})).toBe(2);
    expect(evaluate("-3 + 5", {})).toBe(2);
  });

  it("resolves ${refs} and compares with = and != like XForms", () => {
    expect(evaluate("${a} + ${b}", { a: 2, b: 40 })).toBe(42);
    expect(evaluate("${status} = 'closed'", { status: "closed" })).toBe(true);
    expect(evaluate("${status} != 'closed'", { status: "open" })).toBe(true);
    // Numeric strings compare numerically.
    expect(evaluate("${n} > 5", { n: "10" })).toBe(true);
  });

  it("does boolean logic with and/or/not and if()", () => {
    expect(evaluate("${a} > 1 and ${a} < 10", { a: 5 })).toBe(true);
    expect(evaluate("${a} > 1 or ${a} > 100", { a: 0 })).toBe(false);
    expect(evaluate("not(${done})", { done: false })).toBe(true);
    expect(evaluate("if(${x} > 0, 'pos', 'neg')", { x: -2 })).toBe("neg");
  });

  it("supports selected() and count-selected() over space-joined multi values", () => {
    expect(evaluate("selected(${dmg}, 'flood')", { dmg: "flood wind" })).toBe(true);
    expect(evaluate("selected(${dmg}, 'fire')", { dmg: "flood wind" })).toBe(false);
    expect(evaluate("count-selected(${dmg})", { dmg: "flood wind debris" })).toBe(3);
  });

  it("coalesce, round, string-length, concat", () => {
    expect(evaluate("coalesce(${a}, 'fallback')", { a: null })).toBe("fallback");
    expect(evaluate("round(3.14159, 2)", {})).toBe(3.14);
    expect(evaluate("string-length(${s})", { s: "hello" })).toBe(5);
    expect(evaluate("concat(${a}, '-', ${b})", { a: "SR", b: "169" })).toBe("SR-169");
  });

  it("treats an empty relevant/constraint as satisfied and reports bad syntax", () => {
    expect(evaluateBool("", {})).toBe(true);
    expect(evaluateBool(undefined, {})).toBe(true);
    expect(() => evaluate("2 +", {})).toThrow(ExprError);
    expect(() => evaluate("bogus(1)", {})).toThrow(ExprError);
  });
});

// A compact but representative PDA-style form: a select drives relevance,
// a calculation derives a total, a constraint bounds a value, and a
// repeat collects per-structure damage.
const pdaSheets: XlsFormSheets = {
  survey: [
    { type: "text", name: "assessor", label: "Assessor", required: "yes" },
    { type: "geopoint", name: "location", label: "Location" },
    { type: "select_one damage", name: "worst", label: "Worst damage", required: "yes" },
    {
      type: "integer",
      name: "displaced",
      label: "People displaced",
      relevant: "${worst} != 'affected'",
      constraint: ". >= 0",
      constraint_message: "cannot be negative",
    },
    { type: "begin repeat", name: "structures", label: "Structures" },
    { type: "text", name: "address", label: "Address" },
    { type: "decimal", name: "loss", label: "Estimated loss" },
    { type: "end repeat", name: "structures" },
    { type: "calculate", name: "total_loss", calculation: "coalesce(${displaced}, 0)" },
    { type: "note", name: "thanks", label: "Thank you" },
  ],
  choices: [
    { list_name: "damage", name: "affected", label: "Affected" },
    { list_name: "damage", name: "minor", label: "Minor" },
    { list_name: "damage", name: "major", label: "Major" },
    { list_name: "damage", name: "destroyed", label: "Destroyed" },
  ],
  settings: { form_title: "Preliminary Damage Assessment" },
};

describe("XLSForm import (golden structure)", () => {
  it("builds a nested definition with choices, repeats, and logic columns", () => {
    const def = importXlsForm(pdaSheets, { key: "pda", boardTemplate: "damage" });
    expect(def.title).toBe("Preliminary Damage Assessment");

    const worst = allFields(def.nodes).find((f) => f.name === "worst")!;
    expect(worst.type).toBe("select_one");
    expect(worst.choices?.map((c) => c.name)).toEqual(["affected", "minor", "major", "destroyed"]);

    const repeat = def.nodes.find((n) => n.name === "structures")!;
    expect(repeat.kind).toBe("repeat");
    expect(repeat.kind === "repeat" && repeat.children.map((c) => c.name)).toEqual([
      "address",
      "loss",
    ]);

    const displaced = allFields(def.nodes).find((f) => f.name === "displaced")!;
    expect(displaced.relevant).toBe("${worst} != 'affected'");
    expect(displaced.constraint).toBe(". >= 0");
  });

  it("rejects unbalanced begin/end and bad keys", () => {
    expect(() =>
      importXlsForm({ survey: [{ type: "begin group", name: "g" }], choices: [] }, { key: "x" }),
    ).toThrow(/unbalanced/);
    expect(() => importXlsForm({ survey: [], choices: [] }, { key: "Bad Key" })).toThrow(
      /invalid form key/,
    );
  });
});

describe("the form runner matches source semantics offline", () => {
  const def = importXlsForm(
    {
      survey: [
        { type: "select_one damage", name: "worst", label: "Worst", required: "yes" },
        {
          type: "integer",
          name: "displaced",
          label: "Displaced",
          required: "yes",
          relevant: "${worst} != 'affected'",
          constraint: "${displaced} >= 0",
          constraint_message: "cannot be negative",
        },
        { type: "integer", name: "households", label: "Households" },
        {
          type: "calculate",
          name: "per_household",
          calculation: "if(${households} > 0, ${displaced} div ${households}, 0)",
        },
      ],
      choices: pdaSheets.choices,
    },
    { key: "pda" },
  );

  it("hides an irrelevant field and drops its answer from the submission", () => {
    const answers: AnswerRecord = { worst: "affected", displaced: 5, households: 2 };
    const result = runForm(def, answers);
    expect(result.visible).not.toContain("displaced");
    expect(result.errors).toEqual([]);
    const sub = submission(def, answers);
    expect(sub.displaced).toBeUndefined(); // irrelevant → not submitted
  });

  it("shows the field when relevant, runs the calculation, and enforces required", () => {
    const answers: AnswerRecord = { worst: "major", displaced: 10, households: 4 };
    const result = runForm(def, answers);
    expect(result.visible).toContain("displaced");
    expect(result.values.per_household).toBe(2.5);
    expect(result.errors).toEqual([]);

    const missing = runForm(def, { worst: "major", households: 4 });
    expect(missing.errors).toContainEqual({ field: "displaced", message: "required" });
  });

  it("flags a constraint violation with its message", () => {
    const result = runForm(def, { worst: "destroyed", displaced: -3, households: 1 });
    expect(result.errors).toContainEqual({ field: "displaced", message: "cannot be negative" });
  });
});
