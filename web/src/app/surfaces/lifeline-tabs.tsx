export type LifelineTab = "lifelines" | "esf" | "dependencies" | "history";

const TABS: readonly (readonly [LifelineTab, string])[] = [
  ["lifelines", "Community Lifelines"],
  ["esf", "ESF coordination"],
  ["dependencies", "Dependencies"],
  ["history", "Assessment history"],
];

/** The ESFs & Lifelines workspace's views, one route each. */
export function LifelineTabs(props: { readonly active: LifelineTab; readonly onSelect: (tab: LifelineTab) => void }) {
  return (
    <nav className="eoc-lw-tabs" aria-label="ESFs and Lifelines views">
      {TABS.map(([key, label]) => (
        <button key={key} type="button" aria-current={props.active === key ? "page" : undefined}
          onClick={() => props.onSelect(key)}>
          {label}
        </button>
      ))}
    </nav>
  );
}
