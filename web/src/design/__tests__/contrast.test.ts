import { describe, expect, it } from "vitest";
import { contrastRatio, themes } from "../tokens.js";

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3.0;

describe("token contrast (WCAG 2.1 AA)", () => {
  for (const [name, t] of Object.entries(themes)) {
    describe(`${name} theme`, () => {
      const textPairs: Array<[string, string, string]> = [
        ["text on bg", t.text, t.bg],
        ["text on surface", t.text, t.surface],
        ["text on surfaceRaised", t.text, t.surfaceRaised],
        ["textMuted on surface", t.textMuted, t.surface],
        ["textMuted on surfaceRaised", t.textMuted, t.surfaceRaised],
        ["statusInfo on surface", t.statusInfo, t.surface],
        ["statusWarning on surface", t.statusWarning, t.surface],
        ["statusCritical on surface", t.statusCritical, t.surface],
        ["statusSuccess on surface", t.statusSuccess, t.surface],
        ["statusUnknown on surface", t.statusUnknown, t.surface],
        ["primary button label", t.surface, t.text],
      ];
      for (const [label, fg, bg] of textPairs) {
        it(`${label} meets ${AA_TEXT}:1`, () => {
          expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
        });
      }
      it(`focus indicator on surface meets ${AA_NON_TEXT}:1`, () => {
        expect(contrastRatio(t.focus, t.surface)).toBeGreaterThanOrEqual(AA_NON_TEXT);
      });
    });
  }

  it("the checker itself fails a low-contrast pair (seeded defect proof)", () => {
    expect(contrastRatio("#777777", "#888888")).toBeLessThan(AA_TEXT);
  });

  it("rejects malformed colors instead of passing them", () => {
    expect(() => contrastRatio("#77", "#888888")).toThrow();
  });
});
