/**
 * Design tokens. Color is reserved for status severity (INV-8): the base
 * palette is neutral, and the five status colors are the only saturated
 * values in the system. Every text/background pair is contrast-tested in
 * __tests__/contrast.test.ts; changing a value without keeping AA fails CI.
 */

export type ThemeName = "light" | "dark";

export interface ThemeTokens {
  readonly bg: string;
  readonly surface: string;
  readonly surfaceRaised: string;
  readonly text: string;
  readonly textMuted: string;
  readonly border: string;
  readonly focus: string;
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
    text: "#1a1d21",
    textMuted: "#4b5563",
    border: "#d1d5db",
    focus: "#1d4ed8",
    statusInfo: "#1d4ed8",
    statusWarning: "#92400e",
    statusCritical: "#b91c1c",
    statusSuccess: "#166534",
    statusUnknown: "#4b5563",
  },
  dark: {
    bg: "#0f1214",
    surface: "#171a1e",
    surfaceRaised: "#21262b",
    text: "#e5e7eb",
    textMuted: "#9ca3af",
    border: "#374151",
    focus: "#60a5fa",
    statusInfo: "#60a5fa",
    statusWarning: "#fbbf24",
    statusCritical: "#f87171",
    statusSuccess: "#4ade80",
    statusUnknown: "#9ca3af",
  },
};

export const spacing = [0, 4, 8, 12, 16, 24, 32, 48] as const;

export const fontStack =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

/** Corner radii. A single scale keeps the surface visually consistent. */
export const radii = { sm: 4, md: 6, lg: 10, pill: 999 } as const;

/** Type scale in px: one ramp for every size on the surface. */
export const typeScale = { xs: 12, sm: 13, md: 14, lg: 16, xl: 20, xxl: 28 } as const;

/**
 * Elevation. Shadows are the only depth cue (color stays reserved for
 * status, INV-8), and they are tuned per theme so dark mode lifts without
 * glowing.
 */
export const shadows: Record<ThemeName, { sm: string; md: string; lg: string }> = {
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
export function toCssVariables(theme: ThemeName): Record<string, string> {
  const t = themes[theme];
  return {
    "--eoc-bg": t.bg,
    "--eoc-surface": t.surface,
    "--eoc-surface-raised": t.surfaceRaised,
    "--eoc-text": t.text,
    "--eoc-text-muted": t.textMuted,
    "--eoc-border": t.border,
    "--eoc-focus": t.focus,
    "--eoc-status-info": t.statusInfo,
    "--eoc-status-warning": t.statusWarning,
    "--eoc-status-critical": t.statusCritical,
    "--eoc-status-success": t.statusSuccess,
    "--eoc-status-unknown": t.statusUnknown,
    "--eoc-radius-sm": `${radii.sm}px`,
    "--eoc-radius-md": `${radii.md}px`,
    "--eoc-radius-lg": `${radii.lg}px`,
    "--eoc-shadow-sm": shadows[theme].sm,
    "--eoc-shadow-md": shadows[theme].md,
    "--eoc-shadow-lg": shadows[theme].lg,
    "--eoc-font": fontStack,
  };
}

/** WCAG relative luminance. */
export function relativeLuminance(hex: string): number {
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
