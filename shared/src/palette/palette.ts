/**
 * The palette table's shape, and the helpers that turn it into map
 * expressions, legend rows and CSS variables. One table, keyed by the coded
 * values records store, feeds the map style, the legend, form pick lists and
 * every chart, so a slice, a legend patch and a map symbol for the same value
 * always match. The tables are in tables.ts.
 */

export type PaletteTheme = "light" | "dark";

/**
 * How a value draws as an area: a translucent fill and an outline in the
 * entry's own color unless another is named. A fill opacity of 0 is hollow.
 */
export interface PolygonStyle {
  readonly fillOpacity: number;
  /** Outline width in CSS pixels; 0 draws none. */
  readonly outlineWidth: number;
  /** #rrggbb outline in both themes; the entry's color when left out. */
  readonly outline?: string;
  /** 1 when left out. */
  readonly outlineOpacity?: number;
  /** A diagonal hatch in place of a flat fill. */
  readonly hatch?: boolean;
}

/** The map icon suite's hazard and field icons a point entry draws with. */
export type PaletteIcon =
  | "wildfire" | "structure_fire" | "landslide" | "flooding" | "hazmat_release"
  | "earthquake" | "tsunami" | "road_block" | "damage_report";

export interface PaletteEntry {
  /** The domain label: legend text, pick-list text and chart label alike. */
  readonly label: string;
  /** #rrggbb on the light theme and the street basemap. */
  readonly light: string;
  /** #rrggbb on the dark theme, the dark basemap and imagery. */
  readonly dark: string;
  readonly polygon?: PolygonStyle;
  /** For points: the icon drawn in white on a disc of this color. */
  readonly icon?: PaletteIcon;
  /** The group whose color the entry takes, e.g. an incident type's family. */
  readonly family?: string;
  /** For a numeric field: the class's lower bound, inclusive. */
  readonly min?: number;
}

export interface Palette<K extends string = string> {
  readonly id: string;
  readonly title: string;
  /** Where the colors come from. */
  readonly source: string;
  /** In legend order. */
  readonly entries: Readonly<Record<K, PaletteEntry>>;
  /** Other stored values that read as an entry: product vocabulary and raw source strings. */
  readonly aliases?: Readonly<Record<string, NoInfer<K>>>;
}

/** Declares a palette, checking that every alias names one of its entries. */
export function definePalette<K extends string>(palette: Palette<K>): Palette<K> {
  return palette;
}

/** The entry key a stored value reads as, through its aliases; undefined when the table has none. */
export function paletteKey<K extends string>(palette: Palette<K>, value: string): K | undefined {
  if (Object.hasOwn(palette.entries, value)) return value as K;
  const aliases = palette.aliases ?? {};
  return Object.hasOwn(aliases, value) ? aliases[value] : undefined;
}

/** A theme, for the entry's color, or any other paint value an entry gives. */
type PaletteValue = PaletteTheme | ((entry: PaletteEntry) => unknown);

const picker = (pick: PaletteValue) => (typeof pick === "string" ? (entry: PaletteEntry) => entry[pick] : pick);

/**
 * A MapLibre `match` expression over a feature property, each entry's key and
 * aliases in one branch. Pass a theme for colors, or a function for another
 * paint value: an outline, a fill opacity, an icon.
 */
export function paletteMatch(palette: Palette, property: string, pick: PaletteValue, fallback: unknown): unknown[] {
  const value = picker(pick);
  const aliases = Object.entries(palette.aliases ?? {});
  const branches = Object.entries(palette.entries).flatMap(([key, entry]) => {
    const values = [key, ...aliases.filter(([, to]) => to === key).map(([from]) => from)];
    return [values.length === 1 ? key : values, value(entry)];
  });
  return ["match", ["get", property], ...branches, fallback];
}

/**
 * A MapLibre `step` expression over a numeric property by the entries' lower
 * bounds. A missing value, or one below the first bound, takes the fallback.
 */
export function paletteStep(palette: Palette, property: string, pick: PaletteValue, fallback: unknown): unknown[] {
  const value = picker(pick);
  const classes = Object.values(palette.entries)
    .filter((entry): entry is PaletteEntry & { min: number } => entry.min !== undefined)
    .sort((a, b) => a.min - b.min);
  const below = (classes[0]?.min ?? 0) - 1;
  return ["step", ["number", ["get", property], below], fallback, ...classes.flatMap((entry) => [entry.min, value(entry)])];
}

export type PaletteLegendEntry = PaletteEntry & { readonly key: string; readonly color: string };

/**
 * Legend rows in table order. Given the values features carry, only the
 * entries they name, so a legend lists just what the map shows.
 */
export function paletteLegend(palette: Palette, theme: PaletteTheme, present?: Iterable<string>): PaletteLegendEntry[] {
  const shown = present ? new Set([...present].map((value) => paletteKey(palette, value))) : undefined;
  return Object.entries(palette.entries)
    .filter(([key]) => !shown || shown.has(key))
    .map(([key, entry]) => ({ ...entry, key, color: entry[theme] }));
}

/** The palette as CSS custom properties, `--<prefix>-<key>` with dashes, e.g. `--eoc-series-not-started`. */
export function paletteCssVariables(palette: Palette, theme: PaletteTheme, prefix: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(palette.entries).map(([key, entry]) => [`--${prefix}-${key.replaceAll("_", "-")}`, entry[theme]]),
  );
}
