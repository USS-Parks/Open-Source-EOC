// Generate MapLibre glyph PBF ranges from a TrueType font in the offline toolchain.
// Used by build-bundled-basemap.sh. Requires the 'fontnik' npm package.
//
// Env: FONT_TTF (path to .ttf), FONT_STACK (dir name the style requests),
//      OUT (output fonts directory).
import fontnik from "fontnik";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const ttf = readFileSync(process.env.FONT_TTF);
const stack = process.env.FONT_STACK ?? "Liberation Sans Regular";
const outDir = `${process.env.OUT ?? "./fonts"}/${stack}`;
mkdirSync(outDir, { recursive: true });

// Latin, Latin-1, Extended-A/B, combining, and general punctuation ranges,
// which cover US and California place and road names.
const ranges = [
  [0, 255],
  [256, 511],
  [512, 767],
  [768, 1023],
  [1024, 1279],
  [7680, 7935],
  [8192, 8447],
];

for (const [start, end] of ranges) {
  await new Promise((resolve, reject) => {
    fontnik.range({ font: ttf, start, end }, (err, buf) => {
      if (err) return reject(err);
      writeFileSync(`${outDir}/${start}-${end}.pbf`, buf);
      resolve();
    });
  });
}
console.log(`wrote ${ranges.length} glyph ranges to ${outDir}`);
