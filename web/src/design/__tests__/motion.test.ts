import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const design = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(design, "..");
const baseCss = readFileSync(join(design, "base.css"), "utf8");

function stylesheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? stylesheets(join(dir, entry.name))
    : entry.name.endsWith(".css") ? [join(dir, entry.name)] : []);
}

describe("reduced motion", () => {
  it("stops every animation and transition, sparing only the spinner, which slows", () => {
    const rule = /@media \(prefers-reduced-motion: reduce\) \{\s*\*:not\(\.eoc-kit-spinner\),\s*\*::before,\s*\*::after \{([^}]*)\}/.exec(baseCss);
    expect(rule, "the global reduced-motion rule is missing from base.css").not.toBeNull();
    for (const declaration of ["animation-duration: 0.01ms !important", "animation-iteration-count: 1 !important",
      "transition: none !important", "scroll-behavior: auto !important"]) {
      expect(rule![1]).toContain(declaration);
    }
  });

  it("leaves no stylesheet an !important animation or transition that would outrank it", () => {
    const offenders = stylesheets(source).flatMap((file) => {
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g, "");
      return [...css.matchAll(/(animation|transition)[\w-]*\s*:[^;}]*!important/g)].map((match) => `${file}: ${match[0]}`);
    });
    expect(offenders).toEqual([]);
  });
});
