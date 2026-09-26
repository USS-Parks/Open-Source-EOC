import {
  DAMAGE_DEGREE_PALETTE,
  PA_CATEGORY_PALETTE,
  SHELTER_STATUS_PALETTE,
  paletteCssVariables,
  paletteKey,
  type Palette,
} from "@openeoc/shared";

/**
 * The shared palette tables the incident dashboards color by, as themed CSS
 * variables (`--eoc-degree-major`, `--eoc-pa-a-debris-removal`,
 * `--eoc-shelter-open`), so a chart takes the same light and dark values as
 * the map and legends. Work status colors come through the chart kit.
 */
const THEMED: readonly (readonly [Palette, string])[] = [
  [DAMAGE_DEGREE_PALETTE, "eoc-degree"],
  [PA_CATEGORY_PALETTE, "eoc-pa"],
  [SHELTER_STATUS_PALETTE, "eoc-shelter"],
];

const RULES = (["light", "dark"] as const).map((theme) => {
  const variables = THEMED.flatMap(([palette, prefix]) => Object.entries(paletteCssVariables(palette, theme, prefix)));
  return `.eoc-theme[data-theme="${theme}"] { ${variables.map(([name, value]) => `${name}: ${value};`).join(" ")} }`;
}).join("\n");

/** The variables above; React hoists one copy into the document head however many dashboards render it. */
export function PaletteVariables() {
  return <style href="eoc-incident-dashboard-palettes" precedence="default">{RULES}</style>;
}

function color(palette: Palette, prefix: string, value: string): string | undefined {
  const key = paletteKey(palette, value);
  return key === undefined ? undefined : `var(--${prefix}-${key.replaceAll("_", "-")})`;
}

/** A stored value's color from its table, through its aliases; undefined when the table has no entry for it. */
export const degreeColor = (value: string) => color(DAMAGE_DEGREE_PALETTE, "eoc-degree", value);
export const paCategoryColor = (value: string) => color(PA_CATEGORY_PALETTE, "eoc-pa", value);
export const shelterColor = (value: string) => color(SHELTER_STATUS_PALETTE, "eoc-shelter", value);
