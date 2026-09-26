import { useState, type CSSProperties } from "react";
import { IAP_DISPLAY_STATES, type IapDisplayState, type IapWorkspaceItem } from "@openeoc/shared";
import { ProgressBar, StatusTiles, statusPalette, type ChartDatum } from "../../design/charts/index.js";
import { Icon } from "../../design/icons/Icon.js";
import type { IconName } from "../../design/icons/registry.js";
import "./boards.css";

/**
 * The IAP dashboard, after WebEOC's Incident Action Plan list: status tiles
 * that filter, and a row per plan with a status block, its forms against
 * the standard set as "x of y" and a progress bar, the operational period
 * and who prepared and approved it.
 */

export const IAP_STATUS: Readonly<Record<IapDisplayState, { readonly label: string; readonly color: string; readonly icon: IconName }>> = {
  not_started: { label: "Not started", color: statusPalette.notStarted, icon: "minus" },
  in_progress: { label: "In progress", color: statusPalette.inProgress, icon: "edit" },
  in_approval: { label: "In approval", color: statusPalette.inApproval, icon: "clock" },
  approved: { label: "Approved", color: statusPalette.approved, icon: "iap" },
  complete: { label: "Complete", color: statusPalette.complete, icon: "checkCircleSolid" },
};

/** Plans per display state, counted from the rows the dashboard lists. */
export function iapTiles(items: readonly IapWorkspaceItem[]): ChartDatum[] {
  return IAP_DISPLAY_STATES.map((state) => ({
    key: state,
    label: IAP_STATUS[state].label,
    value: items.filter((item) => item.status === state).length,
    color: IAP_STATUS[state].color,
  }));
}

const stamp = (iso: string) => new Date(iso).toLocaleString([], {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function IapDashboard(props: {
  readonly items: readonly IapWorkspaceItem[] | null;
  readonly error?: string | null;
  /** The plans' scope in words, e.g. "All operational periods". */
  readonly scope: string;
  readonly onOpen: (id: string) => void;
}) {
  const [state, setState] = useState<IapDisplayState | null>(null);
  if (!props.items) {
    return props.error
      ? <p role="alert" className="eoc-board-state is-error">Plans could not be loaded: {props.error}</p>
      : <p role="status" className="eoc-board-state">Loading plans…</p>;
  }
  const shown = state ? props.items.filter((item) => item.status === state) : props.items;
  return (
    <div className="eoc-board">
      <div className="eoc-board-toolbar">
        <div className="eoc-board-title">
          <h3>Plans ({shown.length})</h3>
          <p className="eoc-board-filter" role="status">
            {state ? <>Showing {shown.length} of {props.items.length}: {IAP_STATUS[state].label.toLocaleLowerCase()}.{" "}
              <button type="button" className="eoc-board-link" onClick={() => setState(null)}>Clear filter</button></>
              : props.scope}
          </p>
        </div>
        <StatusTiles label="Plans by status" items={iapTiles(props.items)} selectedKey={state}
          onSelect={(key) => setState((current) => (current === key ? null : key as IapDisplayState))} />
      </div>
      <section className="eoc-board-panel" aria-label="Plans">
        <div className="eoc-board-head eoc-board-iap-grid" aria-hidden="true">
          <span>Status</span><span>Plan</span><span>Forms</span><span>Operational period</span><span>Prepared by</span><span>Approved by</span>
        </div>
        {props.items.length === 0 ? (
          <p className="eoc-board-empty">No plans in this view yet. Assemble one from the period's ICS forms.</p>
        ) : shown.length === 0 ? (
          <p className="eoc-board-empty">None right now.</p>
        ) : (
          <ul className="eoc-board-rows">
            {shown.map((item) => {
              const status = IAP_STATUS[item.status];
              const title = item.period?.label ?? item.operationalPeriod;
              return (
                <li key={item.id} className="eoc-board-row eoc-board-iap-grid is-blocked"
                  style={{ "--eoc-board-color": status.color } as CSSProperties}>
                  <span className="eoc-board-block" aria-hidden="true">
                    <span><Icon name={status.icon} decorative size={20} /></span>
                  </span>
                  <span className="eoc-board-main">
                    <button type="button" className="eoc-board-open" onClick={() => props.onOpen(item.id)}
                      aria-label={`Open ${title}, revision ${item.revisionNumber}`}>{title}</button>
                    <span className="eoc-board-status">{status.label}<span className="eoc-board-muted"> · revision {item.revisionNumber}</span></span>
                  </span>
                  <ProgressBar value={item.progress.completed} max={item.progress.required} color={status.color}
                    label={`${title} forms in the plan`} />
                  <span className="eoc-board-cell eoc-board-period">
                    {item.period ? <><span>{stamp(item.period.startsAt)}</span><span>to {stamp(item.period.endsAt)}</span></> : "No period dates"}
                  </span>
                  <span className="eoc-board-chips">
                    <span className="eoc-board-chip" title={item.preparedAttribution.roleLabel}>{item.preparedAttribution.roleLabel}</span>
                    <span className="eoc-board-chip" title={item.preparedAttribution.organizationName}>{item.preparedAttribution.organizationName}</span>
                  </span>
                  <span className="eoc-board-chips">
                    {item.approvedBy ? <span className="eoc-board-chip" title={item.approvedBy}>{item.approvedBy}</span>
                      : <span className="eoc-board-muted">Not approved</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
