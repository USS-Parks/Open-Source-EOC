/**
 * Project-owned brand marks, one per theme as the canonical frames draw them:
 * the light frames' ring with four cardinal knobs around a filled core, and
 * the dark frame's compass needle inside a two-tone ring.
 */
export function BrandMark(props: { readonly variant?: "ring" | "compass" }) {
  const line = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (props.variant === "compass") {
    return (
      <svg className="eoc-shell-brand-mark is-compass" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 3.3A8.7 8.7 0 0 0 12 20.7" {...line} strokeWidth={1.4} />
        <path className="eoc-shell-brand-accent" d="M12 3.3A8.7 8.7 0 0 1 12 20.7" fill="none" strokeWidth={1.4} strokeLinecap="round" />
        <path d="M12 0.8 8.3 17.6 12 15 Z" fill="currentColor" />
        <path className="eoc-shell-brand-accent-fill" d="M12 0.8 15.7 17.6 12 15 Z" />
        <path d="M2 12 3.6 11.2 3.6 12.8 Z M22 12 20.4 11.2 20.4 12.8 Z M12 23 11.2 21.4 12.8 21.4 Z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className="eoc-shell-brand-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="7.2" {...line} />
      <path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2" {...line} />
      <circle cx="12" cy="2.6" r="1.6" fill="currentColor" />
      <circle cx="12" cy="21.4" r="1.6" fill="currentColor" />
      <circle cx="2.6" cy="12" r="1.6" fill="currentColor" />
      <circle cx="21.4" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="4.4" fill="currentColor" />
      <circle className="eoc-shell-brand-core" cx="12" cy="12" r="3" />
    </svg>
  );
}
