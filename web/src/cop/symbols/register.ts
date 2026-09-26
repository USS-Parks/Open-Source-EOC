import { composeIcon, shapeFor } from "./compose.js";
import type { IconId } from "./glyphs.js";

/** The part of a MapLibre map that images need. */
export interface ImageHost {
  hasImage(id: string): boolean;
  addImage(id: string, image: HTMLImageElement, options: { pixelRatio: number }): unknown;
}

/** One icon in one color, as the map needs it. */
export interface IconRequest {
  readonly id: IconId;
  /** #rrggbb */
  readonly color: string;
}

/** The map image id of an icon in a color, e.g. `eoc-sym-hospital-c62839`. */
export function iconImageId(id: IconId, color: string): string {
  return `eoc-sym-${id}-${color.replace("#", "").toLowerCase()}`;
}

/** The icon as a data URL, for HTML that cannot inline SVG. */
export function symbolDataUrl(id: IconId, color: string, size = 24): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(composeIcon(id, shapeFor(id), color, size))}`;
}

/**
 * Register icons as map images at `size` CSS pixels, rasterized at the
 * device pixel ratio and never below 2, so they stay crisp at 100, 125 and
 * 200 percent display scaling and when a layer's icon-size enlarges them.
 * Icons already on the map are left alone, so this may run on every style load.
 */
export async function ensureIconImages(
  map: ImageHost,
  icons: readonly IconRequest[],
  size = 24,
): Promise<void> {
  const ratio = Math.max(2, globalThis.devicePixelRatio || 1);
  const px = Math.round(size * ratio);
  await Promise.all(icons.map(async ({ id, color }) => {
    const name = iconImageId(id, color);
    if (map.hasImage(name)) return;
    const image = new Image(px, px);
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(composeIcon(id, shapeFor(id), color, size, px / size))}`;
    await image.decode();
    if (!map.hasImage(name)) map.addImage(name, image, { pixelRatio: px / size });
  }));
}
