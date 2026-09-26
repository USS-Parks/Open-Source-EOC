import { colorStyle, seriesColor, statusPalette, type ChartDatum } from "./charts.js";

export interface StatusTilesProps {
  /** Names the group of tiles, e.g. "Plans by status". */
  readonly label: string;
  readonly items: readonly ChartDatum[];
  /** The tile whose filter is on; pass it (or null) to show which one. */
  readonly selectedKey?: string | null | undefined;
  /** Makes each tile a button that filters by its key. */
  readonly onSelect?: ((key: string) => void) | undefined;
}

/** WebEOC IAP-style tiles: a tinted block, a large colored count and its label. */
export function StatusTiles(props: StatusTilesProps) {
  return (
    <ul className="eoc-status-tiles" aria-label={props.label}>
      {props.items.map((item, index) => {
        const content = <><strong>{item.value.toLocaleString()}</strong>{" "}<span>{item.label}</span></>;
        const style = colorStyle(seriesColor(item, index));
        return (
          <li key={item.key}>
            {props.onSelect ? (
              <button type="button" className="eoc-status-tile" style={style}
                aria-pressed={props.selectedKey === undefined ? undefined : props.selectedKey === item.key}
                onClick={() => props.onSelect!(item.key)}>{content}</button>
            ) : <span className="eoc-status-tile" style={style}>{content}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export interface StatusChipsProps {
  /** Names the group of chips, e.g. "Filter lists by status". */
  readonly label: string;
  readonly items: readonly ChartDatum[];
  /** The chips whose filters are on. */
  readonly selectedKeys?: readonly string[] | undefined;
  /** Makes each chip a toggle button for its key. */
  readonly onToggle?: ((key: string) => void) | undefined;
}

/** A row of counted status chips: a colored circle holding the count, then the label. */
export function StatusChips(props: StatusChipsProps) {
  return (
    <ul className="eoc-status-chips" aria-label={props.label}>
      {props.items.map((item, index) => {
        const content = (
          <>
            <span className="eoc-status-chip-count">{item.value.toLocaleString()}</span>{" "}
            <span>{item.label}</span>
          </>
        );
        const style = colorStyle(seriesColor(item, index));
        return (
          <li key={item.key}>
            {props.onToggle ? (
              <button type="button" className="eoc-status-chip" style={style}
                aria-pressed={props.selectedKeys?.includes(item.key) ?? false}
                onClick={() => props.onToggle!(item.key)}>{content}</button>
            ) : <span className="eoc-status-chip" style={style}>{content}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export interface ProgressBarProps {
  readonly value: number;
  readonly max: number;
  /** What is progressing, for assistive technology, e.g. "Power Outage plan forms". */
  readonly label: string;
  /** Fill color; defaults to in progress, or complete when value reaches max. */
  readonly color?: string | undefined;
  /** A thin bar alone, for dense rows that show the count elsewhere. */
  readonly compact?: boolean | undefined;
}

/** A rounded progress bar with "x of y" and its percent. */
export function ProgressBar(props: ProgressBarProps) {
  const max = Number.isFinite(props.max) && props.max > 0 ? props.max : 0;
  const value = max === 0 ? 0 : Math.min(max, Math.max(0, Number.isFinite(props.value) ? props.value : 0));
  // Floor, so a bar reads 100% only when the work is complete.
  const percent = max === 0 ? 0 : Math.floor((value / max) * 100);
  const color = props.color ?? (max > 0 && value === max ? statusPalette.complete : statusPalette.inProgress);
  return (
    <div className="eoc-progress" role="progressbar" aria-label={props.label} aria-valuemin={0} aria-valuemax={max}
      aria-valuenow={value} aria-valuetext={`${value} of ${max}, ${percent}%`} data-compact={props.compact || undefined}
      style={colorStyle(color)}>
      {props.compact ? null : (
        <>
          <span className="eoc-progress-count">{value} of {max}</span>
          <span className="eoc-progress-percent">{percent}%</span>
        </>
      )}
      <span className="eoc-progress-track"><span className="eoc-progress-fill" style={{ width: `${percent}%` }} /></span>
    </div>
  );
}
