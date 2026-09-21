/** Project-owned compass mark settled in the D03 compositions. */
export function BrandMark() {
  const line = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg className="eoc-shell-brand-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8" {...line} />
      <path d="M12 1v6m0 10v6M1 12h6m10 0h6" {...line} />
      <circle cx="12" cy="12" r="2.5" {...line} />
    </svg>
  );
}
