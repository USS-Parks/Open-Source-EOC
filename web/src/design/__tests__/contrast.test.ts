import { describe, expect, it } from "vitest";
import {
  chartCategories,
  contrastRatio,
  moreContrast,
  operationalStates,
  themeTokens,
  themes,
  toCssVariables,
} from "../tokens.js";

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3.0;

describe("token contrast (WCAG 2.1 AA)", () => {
  for (const [name, t] of Object.entries(themes)) {
    describe(`${name} theme`, () => {
      const textPairs: Array<[string, string, string]> = [
        ["text on bg", t.text, t.bg],
        ["text on surface", t.text, t.surface],
        ["text on surfaceRaised", t.text, t.surfaceRaised],
        ["strong text on surface", t.textStrong, t.surface],
        ["textMuted on surface", t.textMuted, t.surface],
        ["textMuted on surfaceRaised", t.textMuted, t.surfaceRaised],
        ["statusInfo on surface", t.statusInfo, t.surface],
        ["statusWarning on surface", t.statusWarning, t.surface],
        ["statusCritical on surface", t.statusCritical, t.surface],
        ["statusSuccess on surface", t.statusSuccess, t.surface],
        ["statusUnknown on surface", t.statusUnknown, t.surface],
        ["primary button label", t.surface, t.text],
        ["navy identity label", t.brandNavyText, t.brandNavy],
        ["teal action label", t.brandTealText, t.brandTeal],
      ];
      for (const [label, fg, bg] of textPairs) {
        it(`${label} meets ${AA_TEXT}:1`, () => {
          expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
        });
      }
      it(`focus indicator on surface meets ${AA_NON_TEXT}:1`, () => {
        expect(contrastRatio(t.focus, t.surface)).toBeGreaterThanOrEqual(AA_NON_TEXT);
      });
      // Text fields and selects draw their boundary with borderStrong on every surface they sit on.
      for (const [surface, color] of [["bg", t.bg], ["surface", t.surface], ["surfaceRaised", t.surfaceRaised],
        ["surfaceOverlay", t.surfaceOverlay]] as const) {
        it(`control boundary on ${surface} meets ${AA_NON_TEXT}:1`, () => {
          expect(contrastRatio(t.borderStrong, color)).toBeGreaterThanOrEqual(AA_NON_TEXT);
        });
      }
      it(`brand signal on navy meets ${AA_NON_TEXT}:1`, () => {
        expect(contrastRatio(t.brandSignal, t.brandNavy)).toBeGreaterThanOrEqual(AA_NON_TEXT);
      });
      for (const [index, color] of chartCategories[name as keyof typeof chartCategories].entries()) {
        it(`chart category ${index + 1} on surface meets ${AA_NON_TEXT}:1`, () => {
          expect(contrastRatio(color, t.surface)).toBeGreaterThanOrEqual(AA_NON_TEXT);
        });
      }
      for (const [state, token] of Object.entries(operationalStates[name as keyof typeof operationalStates])) {
        it(`${state} text treatment meets ${AA_TEXT}:1`, () => {
          expect(contrastRatio(token.foreground, token.background)).toBeGreaterThanOrEqual(AA_TEXT);
        });
      }
    });
  }

  describe("higher-contrast preference", () => {
    for (const name of ["light", "dark"] as const) {
      const normal = themes[name];
      const more = themeTokens(name, "more");
      const surfaces = [["bg", more.bg], ["surface", more.surface], ["surfaceRaised", more.surfaceRaised],
        ["surfaceOverlay", more.surfaceOverlay]] as const;
      for (const [surface, color] of surfaces) {
        it(`${name}: text and muted text on ${surface} meet ${AA_TEXT}:1`, () => {
          expect(contrastRatio(more.text, color)).toBeGreaterThanOrEqual(AA_TEXT);
          expect(contrastRatio(more.textMuted, color)).toBeGreaterThanOrEqual(AA_TEXT);
        });
        it(`${name}: borders and the focus ring on ${surface} meet ${AA_NON_TEXT}:1`, () => {
          expect(contrastRatio(more.border, color)).toBeGreaterThanOrEqual(AA_NON_TEXT);
          expect(contrastRatio(more.borderStrong, color)).toBeGreaterThanOrEqual(AA_NON_TEXT);
          expect(contrastRatio(more.focus, color)).toBeGreaterThanOrEqual(AA_NON_TEXT);
        });
      }
      it(`${name}: every strengthened token contrasts more with the surface than the theme's own`, () => {
        for (const key of Object.keys(moreContrast[name]) as Array<keyof typeof normal>) {
          expect(contrastRatio(more[key], more.surface)).toBeGreaterThan(contrastRatio(normal[key], normal.surface));
        }
      });
      it(`${name}: emits the stronger values as the theme's CSS variables`, () => {
        expect(toCssVariables(name, "more")).toMatchObject({
          "--eoc-border": more.border, "--eoc-text-muted": more.textMuted, "--eoc-focus": more.focus,
        });
        expect(toCssVariables(name)["--eoc-border"]).toBe(normal.border);
      });
    }
  });

  it("keeps brand and chart emphasis distinct from operational status colors", () => {
    for (const name of ["light", "dark"] as const) {
      const t = themes[name];
      const statuses = new Set([t.statusWarning, t.statusCritical, t.statusSuccess, t.statusUnknown]);
      expect(statuses.has(t.brandNavy)).toBe(false);
      expect(statuses.has(t.brandTeal)).toBe(false);
      for (const category of chartCategories[name]) expect(statuses.has(category)).toBe(false);
    }
  });

  it("gives missing-data and zero states explicit non-color semantics", () => {
    for (const name of ["light", "dark"] as const) {
      const states = operationalStates[name];
      const exceptional = [states.unknown, states.stale, states.unavailable, states.notApplicable, states.zero];
      expect(new Set(exceptional.map((token) => `${token.marker}:${token.treatment}`)).size).toBe(exceptional.length);
      expect(states.zero.treatment).toBe("numeric");
      expect(states.zero.foreground).not.toBe(themes[name].statusSuccess);
      expect(new Set(Object.values(states).map((token) => token.label)).size).toBe(8);
    }
  });

  it("the checker itself fails a low-contrast pair (seeded defect proof)", () => {
    expect(contrastRatio("#777777", "#888888")).toBeLessThan(AA_TEXT);
  });

  it("rejects malformed colors instead of passing them", () => {
    expect(() => contrastRatio("#77", "#888888")).toThrow();
  });
});
