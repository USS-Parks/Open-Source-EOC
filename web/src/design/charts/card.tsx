import { useState, type ReactNode } from "react";
import { Menu } from "../controls.js";
import { ModalDialog } from "../overlays.js";
import { ChartFrameContext } from "./charts.js";

export interface ChartCardProps {
  readonly title: string;
  readonly children: ReactNode;
  /** The kebab menu with Full screen and Show as table; on by default. */
  readonly menu?: boolean | undefined;
  /** Grid columns and rows the card spans on a wide screen; one of each when stacked. */
  readonly columns?: 1 | 2 | 3 | undefined;
  readonly rows?: 1 | 2 | 3 | undefined;
}

/**
 * A dashboard card: title at top left, a kebab menu at top right that opens
 * the chart full screen or swaps it for its data table. Charts inside read
 * the card's title as their accessible name unless they carry their own.
 */
export function ChartCard(props: ChartCardProps) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="eoc-chart-card" aria-label={props.title} data-columns={props.columns} data-rows={props.rows}>
      <header className="eoc-chart-card-header">
        <h3>{props.title}</h3>
        {props.menu === false ? null : (
          <Menu className="eoc-chart-card-menu" label={`${props.title} options`} items={[
            { id: "full-screen", label: "Full screen", onSelect: () => setExpanded(true) },
            {
              id: "view",
              label: view === "table" ? "Show as chart" : "Show as table",
              onSelect: () => setView((current) => (current === "table" ? "chart" : "table")),
            },
          ]} />
        )}
      </header>
      <ChartFrameContext.Provider value={{ title: props.title, view, expanded: false }}>
        <div className="eoc-chart-card-body">{props.children}</div>
      </ChartFrameContext.Provider>
      <ModalDialog open={expanded} title={props.title} onClose={() => setExpanded(false)}>
        <ChartFrameContext.Provider value={{ title: props.title, view, expanded: true }}>
          <div className="eoc-chart-expanded">{props.children}</div>
        </ChartFrameContext.Provider>
      </ModalDialog>
    </article>
  );
}

/** A responsive grid of chart cards; cards stack on a narrow screen. */
export function DashboardGrid(props: { readonly label?: string | undefined; readonly children: ReactNode }) {
  return props.label
    ? <section className="eoc-chart-grid" aria-label={props.label}>{props.children}</section>
    : <div className="eoc-chart-grid">{props.children}</div>;
}
