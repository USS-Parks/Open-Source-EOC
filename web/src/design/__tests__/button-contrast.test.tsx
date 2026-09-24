// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "../components.js";
import { ActionButton } from "../controls.js";
import { contrastRatio, toCssVariables, type ThemeName } from "../tokens.js";

afterEach(cleanup);

const design = join(dirname(fileURLToPath(import.meta.url)), "..");
const baseCss = readFileSync(join(design, "base.css"), "utf8");
const kitCss = readFileSync(join(design, "kit.css"), "utf8");

/** The declarations of the rule whose selector list names `selector`, read from the stylesheet text. */
function rule(css: string, selector: string): Record<string, string> {
  for (const [, selectors, body] of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors!.split(",").map((part) => part.replace(/\s+/g, " ").trim()).includes(selector)) continue;
    return Object.fromEntries(body!.split(";").map((line) => line.split(":")).filter((pair) => pair.length === 2)
      .map(([name, value]) => [name!.trim(), value!.trim()]));
  }
  throw new Error(`no rule for ${selector}`);
}

/** A color value as a hex, resolving a theme variable; a transparent fill shows the surface beneath. */
function hex(value: string, theme: ThemeName): string {
  const variables = toCssVariables(theme);
  if (value === "transparent") return variables["--eoc-surface"]!;
  const name = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  const resolved = name ? variables[name] : value;
  if (!resolved) throw new Error(`unresolved color ${value}`);
  return resolved;
}

const BUTTON = "button.eoc-btn.is-quiet";
const KIT = ".eoc-kit-button";
const variants: ReadonlyArray<readonly [string, Record<string, string>]> = [
  ["Button quiet", rule(baseCss, BUTTON)],
  ["Button primary", { ...rule(baseCss, BUTTON), ...rule(baseCss, "button.eoc-btn.is-primary") }],
  ["Button danger", { ...rule(baseCss, BUTTON), ...rule(baseCss, "button.eoc-btn.is-danger") }],
  ["ActionButton secondary", rule(kitCss, KIT)],
  ["ActionButton quiet", { ...rule(kitCss, KIT), ...rule(kitCss, ".eoc-kit-button.is-quiet") }],
  ["ActionButton primary", { ...rule(kitCss, KIT), ...rule(kitCss, ".eoc-kit-button.is-primary") }],
  ["ActionButton danger", { ...rule(kitCss, KIT), ...rule(kitCss, ".eoc-kit-button.is-danger") }],
];

describe("plain button contrast (WCAG 2.1 AA)", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const [label, declared] of variants) {
      it(`${label} label meets 4.5:1 in the ${theme} theme`, () => {
        expect(contrastRatio(hex(declared.color!, theme), hex(declared.background!, theme))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("renders each Button kind with the classes those rules select", () => {
    const { getAllByRole } = render(<>
      <Button>Quiet</Button><Button kind="primary">Primary</Button><Button kind="danger">Danger</Button>
      <ActionButton>Secondary</ActionButton><ActionButton kind="quiet">Quiet action</ActionButton>
    </>);
    expect(getAllByRole("button").map((button) => button.className)).toEqual([
      "eoc-btn is-quiet", "eoc-btn is-primary", "eoc-btn is-danger", "eoc-kit-button is-secondary", "eoc-kit-button is-quiet",
    ]);
  });

  it("changes button and row colors at once for reduced motion, so a theme switch never shows a half-faded button", () => {
    const outsideNoPreference = baseCss.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, "");
    expect(baseCss).toMatch(/@media \(prefers-reduced-motion: no-preference\)/);
    expect(outsideNoPreference).not.toMatch(/transition/);
  });
});
