/** Project-owned compass mark: a ring with four cardinal knobs around a filled core. */
export function BrandMark() {
  const line = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
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
