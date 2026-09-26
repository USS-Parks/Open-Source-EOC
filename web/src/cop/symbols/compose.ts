import { GLYPHS, type IconId } from "./glyphs.js";

/**
 * A complete symbol: a glyph in white on its colored shape, following Esri's
 * emergency management convention. Operational symbols (incident facilities,
 * hazards, field reports) sit on a disc, reference critical facilities on a
 * rounded square, and the incident command post is the ICS square split
 * diagonally. Every shape carries a white halo inside a 28 percent black edge,
 * so it reads over imagery and over light and dark basemaps alike.
 *
 * Symbols are drawn on a 24 unit frame; `size` sets the CSS size and `scale`
 * the pixels per CSS pixel of the returned SVG (2 for a 2x raster).
 */

export type IconShape = "disc" | "square" | "ics";

const HEX = /^#[0-9a-f]{6}$/i;
const EDGE = `fill="#000" fill-opacity="0.28"`;

/** The glyph's 24 grid is scaled by this much into each shape. */
const GLYPH_SCALE: Readonly<Record<Exclude<IconShape, "ics">, number>> = { disc: 0.72, square: 0.76 };

/** The shape the convention gives an icon. */
export function shapeFor(id: IconId): IconShape {
  if (id === "command_post") return "ics";
  return GLYPHS[id].group === "critical" ? "square" : "disc";
}

function frame(shape: IconShape, color: string): string {
  if (shape === "disc") {
    return `<circle cx="12" cy="12" r="11.5" ${EDGE}/><circle cx="12" cy="12" r="11" fill="#fff"/>` +
      `<circle cx="12" cy="12" r="10" fill="${color}"/>`;
  }
  // The square is a unit smaller than the disc so the two read as the same size.
  if (shape === "square") {
    return `<rect x="1" y="1" width="22" height="22" rx="4.6" ${EDGE}/>` +
      `<rect x="1.5" y="1.5" width="21" height="21" rx="4.1" fill="#fff"/>` +
      `<rect x="2.5" y="2.5" width="19" height="19" rx="3.2" fill="${color}"/>`;
  }
  // ICS incident command post: a square in the color, its lower right half white.
  return `<rect x="1" y="1" width="22" height="22" rx="1.6" ${EDGE}/>` +
    `<rect x="1.5" y="1.5" width="21" height="21" rx="1.1" fill="#fff"/>` +
    `<rect x="2.5" y="2.5" width="19" height="19" fill="${color}"/>` +
    `<path d="M19.9 4.1V19.9H4.1Z" fill="#fff"/>`;
}

/** The symbol as a standalone SVG document. `color` is a #rrggbb hex. */
export function composeIcon(id: IconId, shape: IconShape, color: string, size = 24, scale = 1): string {
  if (!HEX.test(color)) throw new Error(`icon color must be #rrggbb, got ${color}`);
  const px = Math.round(size * scale * 100) / 100;
  const k = shape === "ics" ? 0 : GLYPH_SCALE[shape];
  const offset = Math.round((12 - 12 * k) * 1000) / 1000;
  const glyph = shape === "ics" ? "" :
    `<g transform="translate(${offset} ${offset}) scale(${k})" fill="#fff" color="#fff">${GLYPHS[id].body}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24">${frame(shape, color)}${glyph}</svg>`;
}
