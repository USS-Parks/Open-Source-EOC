import { composeIcon, shapeFor } from "./compose.js";
import type { IconId } from "./glyphs.js";

export interface SymbolPatchProps {
  readonly id: IconId;
  /** #rrggbb, the same color the map draws the icon in. */
  readonly color: string;
  /** CSS pixels. */
  readonly size?: number;
  /** An accessible name; without one the patch is decorative and hidden from assistive technology. */
  readonly label?: string;
}

/** A map icon drawn inline, for legends and inspectors, from the same SVG the map uses. */
export function SymbolPatch({ id, color, size = 20, label }: SymbolPatchProps) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  return (
    <span
      {...a11y}
      className="eoc-symbol-patch"
      style={{ display: "inline-flex", flex: "none", width: size, height: size }}
      // The markup is composed here from fixed glyphs and a validated hex color.
      dangerouslySetInnerHTML={{ __html: composeIcon(id, shapeFor(id), color, size) }}
    />
  );
}
