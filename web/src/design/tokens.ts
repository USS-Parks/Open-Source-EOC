/**
 * Design tokens. Brand, category and operational colors have distinct
 * semantics under the approved INV-8 refinement. Text/background pairs are contrast-tested in
 * __tests__/contrast.test.ts; changing a value without keeping AA fails CI.
 */

export type ThemeName = "light" | "dark";

export interface ThemeTokens {
  readonly bg: string;
  readonly surface: string;
  readonly surfaceRaised: string;
  readonly surfaceSunken: string;
  readonly surfaceOverlay: string;
  readonly text: string;
  readonly textStrong: string;
  readonly textMuted: string;
  readonly border: string;
  readonly borderStrong: string;
  readonly focus: string;
  readonly brandNavy: string;
  readonly brandNavyText: string;
  readonly brandTeal: string;
  readonly brandTealText: string;
  readonly brandSignal: string;
  readonly brandTint: string;
  readonly selection: string;
  readonly statusInfo: string;
  readonly statusWarning: string;
  readonly statusCritical: string;
  readonly statusSuccess: string;
  readonly statusUnknown: string;
}

export const themes: Readonly<Record<ThemeName, ThemeTokens>> = {
  light: {
    bg: "#f7f8f9",
    surface: "#ffffff",
    surfaceRaised: "#eef1f4",
    surfaceSunken: "#e8eef1",
    surfaceOverlay: "#ffffff",
    text: "#1a1d21",
    textStrong: "#101820",
    textMuted: "#4b5563",
    border: "#d1d5db",
    borderStrong: "#7b8792",
    focus: "#1d4ed8",
    brandNavy: "#12324a",
    brandNavyText: "#ffffff",
    brandTeal: "#006c6f",
    brandTealText: "#ffffff",
    brandSignal: "#63d5cf",
    brandTint: "#d9efef",
    selection: "#d4eeee",
    statusInfo: "#1d4ed8",
    statusWarning: "#92400e",
    statusCritical: "#b91c1c",
    statusSuccess: "#166534",
    statusUnknown: "#4b5563",
  },
  dark: {
    bg: "#0b1b2b",
    surface: "#142738",
    surfaceRaised: "#193044",
    surfaceSunken: "#091624",
    surfaceOverlay: "#20374b",
    text: "#e5e7eb",
    textStrong: "#ffffff",
    textMuted: "#9ca3af",
    border: "#374151",
    borderStrong: "#7a8694",
    focus: "#60a5fa",
    brandNavy: "#12324a",
    brandNavyText: "#ffffff",
    brandTeal: "#63d5cf",
    brandTealText: "#062b2d",
    brandSignal: "#63d5cf",
    brandTint: "#123e42",
    selection: "#16484b",
    statusInfo: "#60a5fa",
    statusWarning: "#fbbf24",
    statusCritical: "#f87171",
    statusSuccess: "#4ade80",
    statusUnknown: "#9ca3af",
  },
};

/**
 * Stronger text, borders and focus for a higher-contrast preference
 * (prefers-contrast: more), laid over either theme. Measured in
 * __tests__/contrast.test.ts.
 */
export const moreContrast: Readonly<Record<ThemeName, Partial<ThemeTokens>>> = {
  light: {
    text: "#101820",
    textMuted: "#374151",
    border: "#6b7280",
    borderStrong: "#374151",
    focus: "#1e3a8a",
  },
  dark: {
    text: "#f3f4f6",
    textMuted: "#d1d5db",
    border: "#8b95a1",
    borderStrong: "#c3cad3",
    focus: "#93c5fd",
  },
};

export type ContrastPreference = "normal" | "more";

/** A theme's tokens with the higher-contrast layer applied when asked for. */
export function themeTokens(theme: ThemeName, contrast: ContrastPreference = "normal"): ThemeTokens {
  return contrast === "more" ? { ...themes[theme], ...moreContrast[theme] } : themes[theme];
}

export const fontStack =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

/** Corner radii. A single scale keeps the surface visually consistent. */
const radii = { sm: 4, md: 6, pill: 999 } as const;

/** Compact is for dense workspaces; touch preserves the field minimum. */
export const density = {
  compact: { controlHeight: 32, rowHeight: 36, gap: 4 },
  comfortable: { controlHeight: 40, rowHeight: 44, gap: 8 },
  touch: { controlHeight: 44, rowHeight: 48, gap: 8 },
} as const;

export const chartCategories: Readonly<Record<ThemeName, readonly string[]>> = {
  light: ["#245c8f", "#6b4c9a", "#007b83", "#a64b00", "#9b3b75", "#5e6b2f"],
  dark: ["#6eb6ff", "#c19cff", "#5bd4de", "#ffad66", "#f58bc2", "#b8ca6c"],
};

export type OperationalState =
  | "normal"
  | "watch"
  | "critical"
  | "unknown"
  | "stale"
  | "unavailable"
  | "notApplicable"
  | "zero";

interface OperationalStateToken {
  readonly label: string;
  readonly foreground: string;
  readonly background: string;
  readonly marker: "circle" | "triangle" | "diamond" | "question" | "clock" | "dash" | "slash" | "zero";
  readonly treatment: "solid" | "striped" | "outline" | "muted" | "numeric";
}

/** Labels and markers carry meaning when color is unavailable. Zero is neutral data. */
export const operationalStates: Readonly<
  Record<ThemeName, Readonly<Record<OperationalState, OperationalStateToken>>>
> = {
  light: {
    normal: { label: "Normal", foreground: "#166534", background: "#dcfce7", marker: "circle", treatment: "solid" },
    watch: { label: "Watch", foreground: "#92400e", background: "#fef3c7", marker: "triangle", treatment: "solid" },
    critical: { label: "Critical", foreground: "#b91c1c", background: "#fee2e2", marker: "diamond", treatment: "solid" },
    unknown: { label: "Unknown", foreground: "#4b5563", background: "#eef1f4", marker: "question", treatment: "outline" },
    stale: { label: "Stale", foreground: "#7c4a03", background: "#fff4d6", marker: "clock", treatment: "striped" },
    unavailable: { label: "Unavailable", foreground: "#4b5563", background: "#e5e7eb", marker: "dash", treatment: "muted" },
    notApplicable: { label: "Not applicable", foreground: "#4b5563", background: "#f3f4f6", marker: "slash", treatment: "muted" },
    zero: { label: "Zero", foreground: "#1a1d21", background: "#ffffff", marker: "zero", treatment: "numeric" },
  },
  dark: {
    normal: { label: "Normal", foreground: "#4ade80", background: "#12351f", marker: "circle", treatment: "solid" },
    watch: { label: "Watch", foreground: "#fbbf24", background: "#3b2d09", marker: "triangle", treatment: "solid" },
    critical: { label: "Critical", foreground: "#f87171", background: "#40191b", marker: "diamond", treatment: "solid" },
    unknown: { label: "Unknown", foreground: "#b4bdc7", background: "#272d33", marker: "question", treatment: "outline" },
    stale: { label: "Stale", foreground: "#fbbf24", background: "#34280d", marker: "clock", treatment: "striped" },
    unavailable: { label: "Unavailable", foreground: "#b4bdc7", background: "#21262b", marker: "dash", treatment: "muted" },
    notApplicable: { label: "Not applicable", foreground: "#b4bdc7", background: "#171a1e", marker: "slash", treatment: "muted" },
    zero: { label: "Zero", foreground: "#e5e7eb", background: "#171a1e", marker: "zero", treatment: "numeric" },
  },
};

/** Placement is visual hierarchy only; it conveys no incident command authority. */
export const identityPlacement = {
  product: "commandBarStart",
  organization: "commandBarSecondary",
  incident: "contextBar",
} as const;

/**
 * Elevation. Shadows complement semantic surfaces and are tuned per theme so dark mode lifts without
 * glowing.
 */
const shadows: Record<ThemeName, { sm: string; md: string; lg: string }> = {
  light: {
    sm: "0 1px 2px rgba(16,24,32,0.06)",
    md: "0 2px 6px rgba(16,24,32,0.08), 0 1px 2px rgba(16,24,32,0.06)",
    lg: "0 8px 24px rgba(16,24,32,0.12)",
  },
  dark: {
    sm: "0 1px 2px rgba(0,0,0,0.40)",
    md: "0 2px 8px rgba(0,0,0,0.50)",
    lg: "0 12px 32px rgba(0,0,0,0.60)",
  },
};

/** Emit the theme as CSS custom properties for a style attribute or tag. */
export function toCssVariables(theme: ThemeName, contrast: ContrastPreference = "normal"): Record<string, string> {
  const t = themeTokens(theme, contrast);
  return {
    "--eoc-bg": t.bg,
    "--eoc-surface": t.surface,
    "--eoc-surface-raised": t.surfaceRaised,
    "--eoc-surface-sunken": t.surfaceSunken,
    "--eoc-surface-overlay": t.surfaceOverlay,
    "--eoc-text": t.text,
    "--eoc-text-strong": t.textStrong,
    "--eoc-text-muted": t.textMuted,
    "--eoc-border": t.border,
    "--eoc-border-strong": t.borderStrong,
    "--eoc-focus": t.focus,
    "--eoc-brand-navy": t.brandNavy,
    "--eoc-brand-navy-text": t.brandNavyText,
    "--eoc-brand-teal": t.brandTeal,
    "--eoc-brand-teal-text": t.brandTealText,
    "--eoc-brand-signal": t.brandSignal,
    "--eoc-brand-tint": t.brandTint,
    "--eoc-selection": t.selection,
    "--eoc-status-info": t.statusInfo,
    "--eoc-status-warning": t.statusWarning,
    "--eoc-status-critical": t.statusCritical,
    "--eoc-status-success": t.statusSuccess,
    "--eoc-status-unknown": t.statusUnknown,
    "--eoc-radius-sm": `${radii.sm}px`,
    "--eoc-radius-md": `${radii.md}px`,
    "--eoc-radius-pill": `${radii.pill}px`,
    "--eoc-shadow-sm": shadows[theme].sm,
    "--eoc-shadow-md": shadows[theme].md,
    "--eoc-shadow-lg": shadows[theme].lg,
    "--eoc-font": fontStack,
  };
}

/** WCAG relative luminance. */
function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a 6-digit hex color: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1]!.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors (1..21). */
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (l1 + 0.05) / (l2 + 0.05);
}
