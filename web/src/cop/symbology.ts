import { SYMBOL_STATUS } from "@openeoc/shared";
import { themes, type ThemeName } from "../design/tokens.js";

/**
 * COP symbology (F19, F14). The NAPSG guideline communicates status by
 * frame color; the calm-screen rule maps every status onto the design
 * system's five status colors, so the map and the boards speak one
 * visual language. Domain enum values roll up to the NAPSG status frame.
 */

export type SymbolStatus = (typeof SYMBOL_STATUS.values)[number];

/** Domain value → NAPSG status frame. Unlisted values render as unknown. */
export const VALUE_STATUS: Readonly<Record<string, SymbolStatus>> = {
  // symbology.status passthrough
  normal: "normal",
  warning: "warning",
  critical: "critical",
  unknown: "unknown",
  // lifelines.status
  stable: "normal",
  stabilizing: "warning",
  unstable: "critical",
  // road closure status
  closed: "critical",
  one_lane: "warning",
  reopened: "normal",
  // EDXL-HAVE facility status
  compromised: "warning",
  evacuating: "critical",
  // resource request priority
  routine: "normal",
  priority: "warning",
  immediate: "critical",
};

/** Record data → the status frame for its marker. */
export function symbolStatusFor(data: Record<string, unknown>): SymbolStatus {
  for (const key of ["severity", "status", "priority"]) {
    const v = data[key];
    if (typeof v === "string" && VALUE_STATUS[v]) return VALUE_STATUS[v];
  }
  return "unknown";
}

/**
 * symbolStatusFor as a MapLibre expression over raw record fields, for vector
 * tiles, where features cannot be tagged before rendering.
 */
export function symbolStatusExpression(): unknown {
  const branches = SYMBOL_STATUS.values.flatMap((status) => [
    Object.keys(VALUE_STATUS).filter((value) => VALUE_STATUS[value] === status),
    status,
  ]);
  return ["severity", "status", "priority"].reduceRight<unknown>(
    (next, key) => ["match", ["get", key], ...branches, next],
    "unknown",
  );
}

/** Status frame → color, from the same tokens the boards use. */
export function statusColor(status: SymbolStatus, theme: ThemeName): string {
  const t = themes[theme];
  switch (status) {
    case "critical":
      return t.statusCritical;
    case "warning":
      return t.statusWarning;
    case "normal":
      return t.statusSuccess;
    default:
      return t.statusUnknown;
  }
}

/** MapLibre match expression coloring features by their _symbolStatus tag. */
export function statusColorExpression(theme: ThemeName): unknown[] {
  return [
    "match",
    ["get", "_symbolStatus"],
    "critical",
    statusColor("critical", theme),
    "warning",
    statusColor("warning", theme),
    "normal",
    statusColor("normal", theme),
    statusColor("unknown", theme),
  ];
}
