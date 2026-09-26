import { createContext, useContext, type CSSProperties } from "react";
import "./charts.css";

/**
 * The chart kit: WebEOC-style donuts, bars, status tiles, chips and progress
 * bars in SVG and CSS. Callers pass counts and series colors; every chart
 * names itself for assistive technology, keeps an equivalent data table, and
 * shows labels and counts so color is never the only carrier of meaning.
 */

/** One category of a chart: a slice, a bar, a tile or a chip. */
export interface ChartDatum {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** Any CSS color. Without one, the chart picks a themed default. */
  readonly color?: string | undefined;
}

/**
 * Work status series: the shared WORK_STATUS_PALETTE, themed through the
 * --eoc-series variables in charts.css (the kit's tests hold the two equal).
 */
export const statusPalette = {
  notStarted: "var(--eoc-series-not-started)",
  inProgress: "var(--eoc-series-in-progress)",
  inApproval: "var(--eoc-series-in-approval)",
  approved: "var(--eoc-series-approved)",
  complete: "var(--eoc-series-complete)",
  pastDue: "var(--eoc-series-past-due)",
  closed: "var(--eoc-series-closed)",
  cancelled: "var(--eoc-series-cancelled)",
} as const;

// Categories without a caller color take the themed status tokens in turn.
const CATEGORY_COLORS = [
  "var(--eoc-status-info)",
  "var(--eoc-status-warning)",
  "var(--eoc-status-success)",
  "var(--eoc-status-critical)",
  "var(--eoc-status-unknown)",
];

export function seriesColor(datum: ChartDatum, index: number): string {
  return datum.color ?? CATEGORY_COLORS[index % CATEGORY_COLORS.length]!;
}

/** A count that can be drawn: negative, missing or non-finite values count as zero. */
function clean(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Whole percentages that add up to exactly 100 (largest remainder), so a
 * legend never reads 99 or 101 percent. All zero gives all zero.
 */
export function percentages(values: readonly number[]): number[] {
  const counts = values.map(clean);
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total === 0) return counts.map(() => 0);
  const exact = counts.map((value) => (value / total) * 100);
  const whole = exact.map(Math.floor);
  const order = exact
    .map((value, index) => ({ index, remainder: value - whole[index]! }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  let missing = 100 - whole.reduce((sum, value) => sum + value, 0);
  for (const { index } of order) {
    if (missing <= 0) break;
    whole[index]! += 1;
    missing -= 1;
  }
  return whole;
}

/** Axis ticks from zero on a 1, 2, 5 step; whole steps when the values are whole. */
export function niceTicks(max: number, integers = true, target = 6): number[] {
  if (!(max > 0)) return [0];
  const rough = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  let step = [1, 2, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= rough)!;
  if (integers) step = Math.max(1, Math.round(step));
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(Math.round(value * 1e6) / 1e6);
  return ticks;
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

/** A share for a legend: whole percent, and "<1%" rather than 0% for a real but tiny share. */
function shareText(value: number, percent: number): string {
  return value > 0 && percent === 0 ? "<1%" : `${percent}%`;
}

/** What the enclosing card tells a chart: its title, table or chart view, and full-screen size. */
interface ChartFrame {
  readonly title: string;
  readonly view: "chart" | "table";
  readonly expanded: boolean;
}

export const ChartFrameContext = createContext<ChartFrame>({ title: "Chart", view: "chart", expanded: false });

interface ChartRow {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

function chartRows(data: readonly ChartDatum[], color?: (datum: ChartDatum, index: number) => string): ChartRow[] {
  return data.map((datum, index) => ({
    key: datum.key,
    label: datum.label,
    value: clean(datum.value),
    color: color ? color(datum, index) : seriesColor(datum, index),
  }));
}

interface SelectProps {
  /** The selected category; pass it (or null) to show selection, leave it out when a click only drills. */
  readonly selectedKey?: string | null | undefined;
  /** Called with a category's key when its slice, bar or legend row is chosen. */
  readonly onSelect?: ((key: string) => void) | undefined;
}

function pressed(props: SelectProps, key: string): boolean | undefined {
  return props.selectedKey === undefined ? undefined : props.selectedKey === key;
}

function dimmed(props: SelectProps, key: string): true | undefined {
  return props.selectedKey != null && props.selectedKey !== key ? true : undefined;
}

/**
 * The equivalent data table. Hidden for screen readers under a chart, shown
 * in place of the chart when its card switches to the table view.
 */
function ChartTable(props: SelectProps & {
  readonly caption: string;
  readonly rows: readonly ChartRow[];
  readonly shares?: readonly string[] | undefined;
  readonly valueLabel: string;
  readonly visible: boolean;
}) {
  return (
    <table className={props.visible ? "eoc-chart-table" : "eoc-visually-hidden"}>
      <caption className={props.visible ? "eoc-visually-hidden" : undefined}>{props.caption}</caption>
      <thead>
        <tr>
          <th scope="col">Category</th>
          <th scope="col">{props.valueLabel}</th>
          {props.shares ? <th scope="col">Share</th> : null}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((row, index) => (
          <tr key={row.key}>
            <th scope="row">
              {props.visible && props.onSelect ? (
                <button type="button" className="eoc-chart-table-select" aria-pressed={pressed(props, row.key)}
                  onClick={() => props.onSelect!(row.key)}>{row.label}</button>
              ) : row.label}
            </th>
            <td>{formatNumber(row.value)}</td>
            {props.shares ? <td>{props.shares[index]}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Empty(props: { readonly text: string; readonly style?: CSSProperties }) {
  return <p className="eoc-chart-empty" style={props.style}>{props.text}</p>;
}

export function colorStyle(color: string): CSSProperties {
  return { "--eoc-chart-color": color } as CSSProperties;
}

interface ChartCommonProps extends SelectProps {
  readonly data: readonly ChartDatum[];
  /** The accessible name and table caption; defaults to the card title. */
  readonly label?: string | undefined;
  /** Shown instead of a chart when there is nothing to count, e.g. "No lists yet". */
  readonly emptyLabel?: string | undefined;
  /** The value column's heading in the data table. */
  readonly valueLabel?: string | undefined;
}

export interface DonutChartProps extends ChartCommonProps {
  /** Small caps under the center total, e.g. "Total", "Lists", "Tasks". */
  readonly caption?: string | undefined;
  /** Adds a VIEW action per legend row, e.g. to open the filtered list. */
  readonly onView?: ((key: string) => void) | undefined;
  /** Diameter in pixels; the ring is about a sixth of it thick. */
  readonly size?: number | undefined;
}

/** Annulus sector from angle a0 to a1, clockwise from twelve o'clock. */
function sectorPath(center: number, outer: number, inner: number, a0: number, a1: number): string {
  const point = (radius: number, angle: number) =>
    `${(center + radius * Math.sin(angle)).toFixed(2)} ${(center - radius * Math.cos(angle)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${point(outer, a0)}A${outer} ${outer} 0 ${large} 1 ${point(outer, a1)}`
    + `L${point(inner, a1)}A${inner} ${inner} 0 ${large} 0 ${point(inner, a0)}Z`;
}

/**
 * A ring with the total in its center and a legend of counts and shares.
 * Keyboard users reach each slice through its legend row.
 */
export function DonutChart(props: DonutChartProps) {
  const frame = useContext(ChartFrameContext);
  const name = props.label ?? frame.title;
  const rows = chartRows(props.data);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const shares = percentages(rows.map((row) => row.value)).map((percent, index) => shareText(rows[index]!.value, percent));
  const caption = props.caption ?? "Total";
  const emptyLabel = props.emptyLabel ?? "Nothing to count yet";
  const valueLabel = props.valueLabel ?? "Count";
  if (frame.view === "table") {
    return <ChartTable caption={name} rows={rows} shares={shares} valueLabel={valueLabel} visible selectedKey={props.selectedKey} onSelect={props.onSelect} />;
  }
  const summary = total === 0
    ? `${name}: ${emptyLabel}.`
    : `${name}: ${formatNumber(total)} ${caption.toLocaleLowerCase()}. ${rows.map((row, index) => `${row.label} ${formatNumber(row.value)} (${shares[index]})`).join(", ")}.`;
  const size = props.size ?? (frame.expanded ? 280 : 150);
  const center = size / 2;
  const outer = center - 1;
  const inner = outer - Math.round(size * 0.16);
  let angle = 0;
  return (
    <figure className="eoc-chart eoc-donut">
      {total === 0 ? (
        <Empty text={emptyLabel} style={{ width: size, height: size }} />
      ) : (
        <svg className="eoc-donut-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={summary}>
          <circle className="eoc-donut-hole" cx={center} cy={center} r={inner} />
          {rows.map((row) => {
            if (row.value === 0) return null;
            const sweep = (row.value / total) * Math.PI * 2;
            const start = angle;
            angle += sweep;
            const common = {
              className: props.onSelect ? "eoc-donut-slice is-clickable" : "eoc-donut-slice",
              fill: row.color,
              "data-dim": dimmed(props, row.key),
              onClick: props.onSelect ? () => props.onSelect!(row.key) : undefined,
            };
            // A lone category is a whole ring, which one arc path cannot draw.
            return sweep >= Math.PI * 2 - 1e-6 ? (
              <path key={row.key} {...common} fillRule="evenodd"
                d={`M${center} ${center - outer}a${outer} ${outer} 0 1 1 0 ${outer * 2}a${outer} ${outer} 0 1 1 0 ${-outer * 2}Z`
                  + `M${center} ${center - inner}a${inner} ${inner} 0 1 1 0 ${inner * 2}a${inner} ${inner} 0 1 1 0 ${-inner * 2}Z`} />
            ) : (
              <path key={row.key} {...common} d={sectorPath(center, outer, inner, start, angle)} />
            );
          })}
          <text className="eoc-donut-total" x={center} y={center - size * 0.035} textAnchor="middle" dominantBaseline="central"
            style={{ fontSize: Math.round(size * 0.22) }}>{formatNumber(total)}</text>
          <text className="eoc-donut-caption" x={center} y={center + size * 0.13} textAnchor="middle" dominantBaseline="central"
            style={{ fontSize: Math.max(9, Math.round(size * 0.065)) }}>{caption.toLocaleUpperCase()}</text>
        </svg>
      )}
      {rows.length > 0 ? (
        <ul className="eoc-donut-legend" aria-label={`${name} legend`}>
          {rows.map((row, index) => {
            const content = (
              <>
                <span className="eoc-chart-swatch" aria-hidden="true" style={{ background: row.color }} />
                <span className="eoc-donut-legend-label" title={row.label}>{row.label}</span>{" "}
                <span className="eoc-donut-legend-count">{formatNumber(row.value)} ({shares[index]})</span>
              </>
            );
            return (
              <li key={row.key} data-dim={dimmed(props, row.key)}>
                {props.onSelect ? (
                  <button type="button" className="eoc-donut-legend-item" aria-pressed={pressed(props, row.key)}
                    onClick={() => props.onSelect!(row.key)}>{content}</button>
                ) : <span className="eoc-donut-legend-item">{content}</span>}
                {props.onView ? (
                  <button type="button" className="eoc-chart-view" aria-label={`View ${row.label}`}
                    onClick={() => props.onView!(row.key)}>View</button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <ChartTable caption={name} rows={rows} shares={shares} valueLabel={valueLabel} visible={false} />
    </figure>
  );
}

export interface BarChartProps extends ChartCommonProps {
  /** Show each bar's count beside it; on by default so the number never rests on length alone. */
  readonly showValues?: boolean | undefined;
}

function barSummary(name: string, rows: readonly ChartRow[]): string {
  const top = rows.reduce((best, row) => (row.value > best.value ? row : best), rows[0]!);
  return `${name}: ${rows.length} categor${rows.length === 1 ? "y" : "ies"}, highest ${top.label} (${formatNumber(top.value)}).`;
}

export interface HBarChartProps extends BarChartProps {
  /** One color for every bar unless a category carries its own. */
  readonly color?: string | undefined;
}

/** Labeled horizontal bars, longest label lists included; a click on a row selects it. */
export function HBarChart(props: HBarChartProps) {
  const frame = useContext(ChartFrameContext);
  const name = props.label ?? frame.title;
  const rows = chartRows(props.data, (datum) => datum.color ?? props.color ?? "var(--eoc-status-info)");
  const valueLabel = props.valueLabel ?? "Count";
  if (frame.view === "table") {
    return <ChartTable caption={name} rows={rows} valueLabel={valueLabel} visible selectedKey={props.selectedKey} onSelect={props.onSelect} />;
  }
  const max = Math.max(0, ...rows.map((row) => row.value));
  const showValues = props.showValues ?? true;
  if (max === 0) {
    return (
      <figure className="eoc-chart eoc-hbar" aria-label={`${name}: ${props.emptyLabel ?? "Nothing to count yet"}.`}>
        <Empty text={props.emptyLabel ?? "Nothing to count yet"} />
        <ChartTable caption={name} rows={rows} valueLabel={valueLabel} visible={false} />
      </figure>
    );
  }
  return (
    <figure className="eoc-chart eoc-hbar" aria-label={barSummary(name, rows)}>
      <ul className="eoc-hbar-list">
        {rows.map((row) => {
          const content = (
            <>
              <span className="eoc-hbar-label" title={row.label}>{row.label}</span>
              <span className="eoc-hbar-track">
                <span role="img" aria-label={`${row.label}: ${row.value}`} className="eoc-hbar-bar"
                  style={{ ...colorStyle(row.color), width: `${(row.value / max) * 100}%` }} />
              </span>
              {showValues ? <span className="eoc-hbar-value">{formatNumber(row.value)}</span> : null}
            </>
          );
          return (
            <li key={row.key} data-dim={dimmed(props, row.key)}>
              {props.onSelect ? (
                <button type="button" className="eoc-hbar-row" aria-label={`${row.label}: ${row.value}`}
                  aria-pressed={pressed(props, row.key)} onClick={() => props.onSelect!(row.key)}>{content}</button>
              ) : <span className="eoc-hbar-row">{content}</span>}
            </li>
          );
        })}
      </ul>
      <ChartTable caption={name} rows={rows} valueLabel={valueLabel} visible={false} />
    </figure>
  );
}

export interface VBarChartProps extends BarChartProps {
  /** Plot height in pixels, not counting the category labels. */
  readonly height?: number | undefined;
}

/** Vertical bars over a y axis with dotted gridlines; each column (bar and label) selects. */
export function VBarChart(props: VBarChartProps) {
  const frame = useContext(ChartFrameContext);
  const name = props.label ?? frame.title;
  const rows = chartRows(props.data);
  const valueLabel = props.valueLabel ?? "Count";
  if (frame.view === "table") {
    return <ChartTable caption={name} rows={rows} valueLabel={valueLabel} visible selectedKey={props.selectedKey} onSelect={props.onSelect} />;
  }
  const max = Math.max(0, ...rows.map((row) => row.value));
  if (max === 0) {
    return (
      <figure className="eoc-chart eoc-vbar" aria-label={`${name}: ${props.emptyLabel ?? "Nothing to count yet"}.`}>
        <Empty text={props.emptyLabel ?? "Nothing to count yet"} />
        <ChartTable caption={name} rows={rows} valueLabel={valueLabel} visible={false} />
      </figure>
    );
  }
  const ticks = niceTicks(max, rows.every((row) => Number.isInteger(row.value)));
  const top = ticks.at(-1)!;
  const showValues = props.showValues ?? true;
  const height = props.height ?? (frame.expanded ? 420 : 220);
  return (
    <figure className="eoc-chart eoc-vbar" aria-label={barSummary(name, rows)}
      style={{ "--eoc-vbar-height": `${height}px` } as CSSProperties}>
      <ol className="eoc-vbar-axis" aria-hidden="true">
        {ticks.map((tick) => <li key={tick} style={{ bottom: `${(tick / top) * 100}%` }}>{formatNumber(tick)}</li>)}
      </ol>
      <div className="eoc-vbar-plot">
        <div className="eoc-vbar-grid" aria-hidden="true">
          {ticks.map((tick) => <span key={tick} style={{ bottom: `${(tick / top) * 100}%` }} />)}
        </div>
        {rows.map((row) => {
          const content = (
            <>
              <span className="eoc-vbar-slot">
                {showValues ? <span className="eoc-vbar-value">{formatNumber(row.value)}</span> : null}
                <span role="img" aria-label={`${row.label}: ${row.value}`} className="eoc-vbar-bar"
                  style={{ ...colorStyle(row.color), height: `${(row.value / top) * 100}%` }} />
              </span>
              <span className="eoc-vbar-label" title={row.label}>{row.label}</span>
            </>
          );
          return props.onSelect ? (
            <button key={row.key} type="button" className="eoc-vbar-col" data-dim={dimmed(props, row.key)}
              aria-label={`${row.label}: ${row.value}`} aria-pressed={pressed(props, row.key)}
              onClick={() => props.onSelect!(row.key)}>{content}</button>
          ) : <span key={row.key} className="eoc-vbar-col" data-dim={dimmed(props, row.key)}>{content}</span>;
        })}
      </div>
      <ChartTable caption={name} rows={rows} valueLabel={valueLabel} visible={false} />
    </figure>
  );
}
