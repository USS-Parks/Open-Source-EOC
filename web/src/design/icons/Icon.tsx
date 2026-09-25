import { useId, type CSSProperties } from "react";
import {
  iconRegistry,
  lifelineIconByKey,
  type IconName,
  type IconPrimitive,
  type IconSize,
  type LifelineKey,
} from "./registry.js";

type AccessibleIcon = { readonly decorative?: false; readonly label: string };
type DecorativeIcon = { readonly decorative: true; readonly label?: never };
type IconAccessibility = AccessibleIcon | DecorativeIcon;

type IconProps = IconAccessibility & {
  readonly name: IconName;
  readonly size?: IconSize;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
};

function primitiveElement(primitive: IconPrimitive, key: number) {
  const filled = "fill" in primitive && primitive.fill === "currentColor";
  const common = filled
    ? { fill: "currentColor", stroke: "none" }
    : { fill: "none" };

  switch (primitive.element) {
    case "path":
      return <path key={key} d={primitive.d} fillRule={primitive.fillRule} {...common} />;
    case "circle":
      return <circle key={key} cx={primitive.cx} cy={primitive.cy} r={primitive.r} {...common} />;
    case "line":
      return <line key={key} x1={primitive.x1} y1={primitive.y1} x2={primitive.x2} y2={primitive.y2} />;
    case "polyline":
      return <polyline key={key} points={primitive.points} />;
    case "rect":
      return (
        <rect
          key={key}
          x={primitive.x}
          y={primitive.y}
          width={primitive.width}
          height={primitive.height}
          rx={primitive.rx}
          {...common}
        />
      );
  }
}

/**
 * Renders one project-owned icon. Meaningful icons require a label;
 * decorative icons are removed from the accessibility tree.
 */
export function Icon(props: IconProps) {
  const titleId = useId();
  const definition = iconRegistry[props.name];
  const size = props.size ?? definition.intendedSizes[1] ?? definition.intendedSizes[0];
  const decorative = props.decorative === true;
  const label = decorative ? undefined : props.label.trim();
  if (!decorative && !label) throw new Error("Meaningful icons require a non-empty label");

  // The root is unfilled: an open polyline (a chevron, a check) stays a line, never a filled wedge.
  return (
    <svg
      aria-hidden={decorative ? true : undefined}
      aria-labelledby={decorative ? undefined : titleId}
      className={["eoc-icon", props.className].filter(Boolean).join(" ")}
      data-category={definition.category}
      data-disabled={props.disabled || undefined}
      data-icon={props.name}
      data-selected={props.selected || undefined}
      fill="none"
      focusable="false"
      height={size}
      role={decorative ? undefined : "img"}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={props.selected ? 2.15 : 1.75}
      style={{
        color: "inherit",
        display: "inline-block",
        flex: "none",
        overflow: "visible",
        verticalAlign: "-0.16em",
        ...props.style,
        opacity: props.disabled ? 0.38 : props.style?.opacity,
      }}
      viewBox={definition.viewBox ?? "0 0 24 24"}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {decorative ? null : <title id={titleId}>{label}</title>}
      {definition.primitives.map(primitiveElement)}
    </svg>
  );
}

type LifelineIconProps = IconAccessibility & {
  readonly lifeline: LifelineKey;
  readonly size?: IconSize;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
};

/** Renders one of the eight canonical community-lifeline silhouettes. */
export function LifelineIcon({ lifeline, ...props }: LifelineIconProps) {
  return <Icon {...props} name={lifelineIconByKey[lifeline]} />;
}
