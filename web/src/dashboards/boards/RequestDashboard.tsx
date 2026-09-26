import { useState, type CSSProperties } from "react";
import { choiceLabel, RESOURCE_REQUEST_ENDED, requestStage, type ResourceRequestSummary } from "@openeoc/shared";
import { ChartCard, HBarChart, StatusTiles, statusPalette, type ChartDatum } from "../../design/charts/index.js";
import { ownerLabel, stageTone, when } from "../../resources/request-view.js";
import "./boards.css";

/**
 * The Requests dashboard on the Resources screen, after WebEOC's
 * Requests/Tasks board: counted tiles and a chart of requests by stage, each
 * filtering the request list beside them. Active and ended follow the
 * request list's own "Open only" and "Ended only" filters, and overdue
 * follows My work: an open request past its needed-by time.
 */

const DAY_MS = 24 * 60 * 60_000;

const ended = (request: ResourceRequestSummary) => RESOURCE_REQUEST_ENDED.includes(request.state);

/** Each tile's rule; the tile's count and the filtered list both come from it. */
export function requestRules(now: number): Readonly<Record<string, (request: ResourceRequestSummary) => boolean>> {
  return {
    active: (request) => !ended(request),
    ended,
    all: () => true,
    deployed: (request) => request.state === "deployed",
    new_24h: (request) => now - new Date(request.createdAt).getTime() <= DAY_MS,
    // An ended request never moves again, so its last stage change is when it ended.
    ended_24h: (request) => ended(request) && now - new Date(request.updatedAt).getTime() <= DAY_MS,
    overdue: (request) => !ended(request) && request.neededBy !== null && new Date(request.neededBy).getTime() < now,
    costed: (request) => (request.costCents ?? 0) > 0,
  };
}

const TILES: readonly { readonly key: string; readonly label: string; readonly color: string }[] = [
  { key: "all", label: "Total requests", color: statusPalette.approved },
  { key: "active", label: "Active", color: statusPalette.inProgress },
  { key: "overdue", label: "Overdue", color: statusPalette.pastDue },
  { key: "deployed", label: "Deployed", color: statusPalette.inApproval },
  { key: "ended", label: "Ended", color: statusPalette.complete },
  { key: "new_24h", label: "New in the last 24 hours", color: statusPalette.approved },
  { key: "ended_24h", label: "Ended in the last 24 hours", color: statusPalette.complete },
];

export function requestTiles(requests: readonly ResourceRequestSummary[], now: number): ChartDatum[] {
  const rules = requestRules(now);
  return TILES.map((tile) => ({ ...tile, value: requests.filter(rules[tile.key]!).length }));
}

// Lifecycle order; a request stored before accepted replaced triaged counts as accepted.
const STAGES = ["draft", "submitted", "accepted", "sourcing", "assigned", "deployed", "fulfilled", "demobilizing", "closed", "declined", "cancelled"];
const stageKey = (state: string) => (state === "triaged" ? "accepted" : state);

/** Requests per stage, every stage after draft shown even at zero so the pipeline reads whole. */
export function requestStages(requests: readonly ResourceRequestSummary[]): ChartDatum[] {
  const counts = new Map<string, number>();
  for (const request of requests) counts.set(stageKey(request.state), (counts.get(stageKey(request.state)) ?? 0) + 1);
  const known = [...STAGES, ...[...counts.keys()].filter((state) => !STAGES.includes(state))];
  return known.filter((state) => state !== "draft" || counts.has(state)).map((state) => ({
    key: state,
    label: requestStage(state),
    value: counts.get(state) ?? 0,
    color: `var(--eoc-status-${stageTone(state)})`,
  }));
}

const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });

type Filter = { readonly by: "tile" | "stage"; readonly key: string };

export function RequestDashboard(props: {
  readonly requests: readonly ResourceRequestSummary[] | null;
  readonly error?: string | null;
  readonly now?: number;
  readonly onOpen: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter | null>(null);
  if (!props.requests) {
    return props.error
      ? <p role="alert" className="eoc-board-state is-error">Requests could not be loaded: {props.error}</p>
      : <p role="status" className="eoc-board-state">Loading requests…</p>;
  }
  const now = props.now ?? Date.now();
  const requests = props.requests;
  const rules = requestRules(now);
  const tiles = requestTiles(requests, now);
  const stages = requestStages(requests);
  const cost = requests.reduce((sum, request) => sum + (request.costCents ?? 0), 0);
  const choose = (by: Filter["by"], key: string) =>
    setFilter((current) => (current?.by === by && current.key === key ? null : { by, key }));
  const shown = !filter ? requests
    : filter.by === "tile" ? requests.filter(rules[filter.key]!)
      : requests.filter((request) => stageKey(request.state) === filter.key);
  const description = !filter ? null
    : filter.by === "stage" ? `at ${stages.find((stage) => stage.key === filter.key)?.label ?? filter.key}`
      : filter.key === "costed" ? "with recorded costs"
        : tiles.find((tile) => tile.key === filter.key)!.label.toLocaleLowerCase();
  const tileKey = filter?.by === "tile" ? filter.key : null;

  return (
    <div className="eoc-board">
      <div className="eoc-board-toolbar is-tiles">
        <StatusTiles label="Requests by count" items={tiles} selectedKey={tileKey} onSelect={(key) => choose("tile", key)} />
        {cost > 0 ? (
          <button type="button" className="eoc-status-tile eoc-board-cost" aria-pressed={tileKey === "costed"}
            style={{ "--eoc-chart-color": "var(--eoc-text-strong)" } as CSSProperties}
            onClick={() => choose("tile", "costed")}><strong>{usd(cost)}</strong> <span>Recorded cost</span></button>
        ) : null}
      </div>
      <div className="eoc-board-split is-chart-right">
        <section className="eoc-board-panel" aria-label="Requests">
          <div className="eoc-board-head eoc-board-request-grid" aria-hidden="true">
            <span>Requests ({shown.length})</span><span>Priority</span><span>Needed by</span><span />
          </div>
          <p className="eoc-board-filter eoc-board-panel-note" role="status">
            {description ? <>Showing {shown.length} of {requests.length} requests, {description}.{" "}
              <button type="button" className="eoc-board-link" onClick={() => setFilter(null)}>Clear filter</button></>
              : `Every request on this incident, open and ended.`}
          </p>
          {requests.length === 0 ? (
            <p className="eoc-board-empty">No resource requests on this incident yet.</p>
          ) : shown.length === 0 ? (
            <p className="eoc-board-empty">None right now.</p>
          ) : (
            <ul className="eoc-board-rows">
              {shown.map((request) => {
                const tone = `var(--eoc-status-${stageTone(request.state)})`;
                const late = rules.overdue!(request);
                return (
                  <li key={request.id} className="eoc-board-row eoc-board-request-grid" style={{ "--eoc-board-color": tone } as CSSProperties}>
                    <span className="eoc-board-main">
                      <strong title={request.item}>REQ-{request.number} {request.item}</strong>
                      <span className="eoc-board-muted" title={ownerLabel(request)}>
                        <span className="eoc-board-status">{requestStage(request.state)}</span> · {ownerLabel(request)}
                      </span>
                    </span>
                    <span className="eoc-board-cell">{choiceLabel(request.priority)}</span>
                    <span className="eoc-board-due">
                      <span>{request.neededBy ? when(request.neededBy) : "Not set"}</span>
                      {late ? <span className="eoc-board-pill">Overdue</span> : null}
                    </span>
                    <button type="button" className="eoc-chart-view" aria-label={`Open REQ-${request.number}`}
                      onClick={() => props.onOpen(request.id)}>Open</button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <ChartCard title="Requests by stage">
          <HBarChart data={stages} emptyLabel="No requests yet" selectedKey={filter?.by === "stage" ? filter.key : null}
            onSelect={(key) => choose("stage", key)} />
        </ChartCard>
      </div>
    </div>
  );
}
