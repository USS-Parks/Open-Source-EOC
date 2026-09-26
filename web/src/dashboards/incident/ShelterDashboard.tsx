import { useState, type CSSProperties } from "react";
import type { FieldDef, ViewDef } from "@openeoc/shared";
import { ApiError, readAllPages, type ApiClient } from "../../app/api/client.js";
import { useAsync } from "../../app/data/hooks.js";
import {
  ChartCard,
  DonutChart,
  ProgressBar,
  StatusTiles,
  VBarChart,
  statusPalette,
} from "../../design/charts/index.js";
import {
  STATE_CATEGORIES,
  featureAnswer,
  featureChart,
  featureFields,
  occupancyHistory,
  occupancyTotals,
  operating,
  recordsAccessibility,
  shelterOf,
  stateLabel,
  stateTiles,
  type Shelter,
} from "./shelters.js";
import { PaletteVariables } from "./palettes.js";
import "./incident-dashboards.css";

/**
 * The Dashboard tab of a Shelters board: shelters by status, occupancy
 * against capacity in all and per shelter, the yes and no fields the board
 * records (pets accepted), and occupancy at the end of each operational
 * period. A tile or slice filters the shelter list under the charts; a
 * shelter's name opens its record.
 */

type Filter = { readonly by: "state"; readonly key: string } | { readonly by: "feature"; readonly field: string; readonly key: string };

type Client = Pick<ApiClient, "boardViewPage" | "boardRecordHistory" | "incidentAreaHistory">;

/** A change history, or null for a record that has none to read (seeded without one). */
async function historyOf(client: Client, boardId: string, recordId: string, incidentId: string | null) {
  try {
    return await readAllPages(async (page) => {
      const result = await client.boardRecordHistory(boardId, recordId, incidentId, page);
      return { items: result.entries, nextCursor: result.nextCursor };
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

const fullness = (shelter: Shelter) => (shelter.capacity > 0 ? shelter.occupancy / shelter.capacity : 0);

function fillColor(shelter: Shelter): string {
  const share = fullness(shelter);
  return share >= 0.9 ? statusPalette.pastDue : share >= 0.75 ? statusPalette.inProgress : statusPalette.approved;
}

export function ShelterDashboard(props: {
  readonly client: Client;
  readonly boardId: string;
  /** The incident the board is read for; null for an organization's own board. */
  readonly incidentId: string | null;
  readonly fields: readonly FieldDef[];
  readonly views: readonly ViewDef[];
  readonly onOpenRecord: (recordId: string) => void;
  /** The clock history is read against; now when left out. */
  readonly now?: number;
}) {
  const [filter, setFilter] = useState<Filter | null>(null);
  // Every shelter: an unfiltered view when the board has one.
  const viewKey = (props.views.find((view) => view.filter.length === 0 && !view.where?.length) ?? props.views[0])?.key ?? null;
  const records = useAsync(() => viewKey ? readAllPages(async (page) => {
    const result = await props.client.boardViewPage(props.boardId, viewKey, props.incidentId ? { incidentId: props.incidentId } : {}, page);
    return { items: result.records, nextCursor: result.nextCursor };
  }) : Promise.resolve([]), [props.boardId, props.incidentId, viewKey]);
  const revisions = useAsync(
    () => props.incidentId ? props.client.incidentAreaHistory(props.incidentId) : Promise.resolve([]),
    [props.incidentId],
  );
  // ponytail: one history read per shelter; a server-side occupancy series if boards grow past a few dozen shelters.
  const histories = useAsync(async () => records.data ? Promise.all(records.data.map(async (record) => ({
    record, history: await historyOf(props.client, props.boardId, record.id, props.incidentId),
  }))) : null, [records.data]);

  if (!records.data) {
    return records.error
      ? <p role="alert" className="eoc-dash-state is-error">Shelters could not be loaded: {records.error}</p>
      : <p role="status" className="eoc-dash-state">Loading shelters…</p>;
  }
  const features = featureFields(props.fields);
  const shelters = records.data.map((record) => shelterOf(record, features))
    .sort((a, b) => STATE_CATEGORIES.findIndex((item) => item.key === a.state) - STATE_CATEGORIES.findIndex((item) => item.key === b.state)
      || a.name.localeCompare(b.name));
  const totals = occupancyTotals(shelters);
  const activeCount = shelters.filter(operating).length;
  const choose = (next: Filter) => setFilter((current) => (JSON.stringify(current) === JSON.stringify(next) ? null : next));
  const shown = !filter ? shelters : shelters.filter((shelter) => filter.by === "state"
    ? shelter.state === filter.key
    : operating(shelter) && featureAnswer(shelter, filter.field) === filter.key);
  const filterName = !filter ? null : filter.by === "state"
    ? `${stateLabel(filter.key as Shelter["state"])} shelters`
    : `${features.find((field) => field.key === filter.field)?.label ?? filter.field}: ${featureChart([], filter.field).find((item) => item.key === filter.key)?.label ?? filter.key}`;
  const history = histories.data && revisions.data ? occupancyHistory(revisions.data, histories.data, props.now ?? Date.now()) : null;
  const noAccessibility = recordsAccessibility(props.fields) ? null : (
    <p className="eoc-dash-note">Accessibility is not recorded on this board, so it is not counted. A board designer can add a yes or no field for it.</p>
  );

  return (
    <div className="eoc-dash eoc-shelter-dash">
      <PaletteVariables />
      <div className="eoc-dash-toolbar">
        <StatusTiles label="Shelters by status" items={stateTiles(shelters)}
          selectedKey={filter?.by === "state" ? filter.key : null} onSelect={(key) => choose({ by: "state", key })} />
      </div>
      <section className="eoc-dash-grid is-trio" aria-label="Shelter charts">
        <ChartCard title="Occupancy against capacity">
          <div className="eoc-shelter-total">
            <p><strong>{totals.occupancy.toLocaleString()}</strong> people in {activeCount} operating {activeCount === 1 ? "shelter" : "shelters"}</p>
            <ProgressBar value={totals.occupancy} max={totals.capacity} label="Occupancy of operating shelters against their capacity"
              color={statusPalette.approved} />
            <dl>
              <div><dt>Capacity</dt><dd>{totals.capacity.toLocaleString()}</dd></div>
              <div><dt>Open spaces</dt><dd>{totals.open.toLocaleString()}</dd></div>
            </dl>
          </div>
        </ChartCard>
        <ChartCard title="Occupancy by operational period">
          {!props.incidentId ? <p className="eoc-dash-note">Occupancy history follows an incident's operational periods. Open this board from an incident to see it.</p>
            : revisions.error || histories.error ? <p role="alert" className="eoc-dash-note">The history could not be read: {revisions.error ?? histories.error}</p>
              : !history ? <p role="status" className="eoc-dash-note">Reading each shelter's change history…</p>
                : history.length === 0 ? <p className="eoc-dash-note">No operational period has begun on this incident, so there is no occupancy history to show yet.</p>
                  : <VBarChart data={history.map((point) => ({ ...point, color: statusPalette.approved }))} valueLabel="Occupants" height={170} />}
        </ChartCard>
        {features.length === 0 ? (
          <ChartCard title="Pets and accessibility" menu={false}>
            <p className="eoc-dash-note">This board records no yes or no fields about its shelters.</p>
            {noAccessibility}
          </ChartCard>
        ) : features.map((field, index) => (
          <ChartCard key={field.key} title={field.label}>
            <DonutChart data={featureChart(shelters, field.key)} caption="Shelters" size={120} emptyLabel="No operating shelters"
              selectedKey={filter?.by === "feature" && filter.field === field.key ? filter.key : null}
              onSelect={(key) => choose({ by: "feature", field: field.key, key })} />
            {index === 0 ? noAccessibility : null}
          </ChartCard>
        ))}
      </section>
      <section className="eoc-dash-list" aria-labelledby="eoc-shelter-list-title">
        <header>
          <h3 id="eoc-shelter-list-title">
            {filterName ?? "Every shelter"}
            <span className="eoc-dash-count"> {shown.length} {shown.length === 1 ? "shelter" : "shelters"}</span>
          </h3>
          {filter ? <button type="button" className="eoc-dash-link" onClick={() => setFilter(null)}>Clear filter</button> : null}
        </header>
        {shelters.length === 0 ? <p className="eoc-dash-empty">No shelters are recorded on this board yet.</p>
          : shown.length === 0 ? <p className="eoc-dash-empty">None right now.</p> : (
            <ul className="eoc-dash-rows">
              {shown.map((shelter) => {
                const color = STATE_CATEGORIES.find((item) => item.key === shelter.state)!.color;
                const over = shelter.occupancy > shelter.capacity;
                return (
                  <li key={shelter.id} className="eoc-dash-row eoc-shelter-row" style={{ "--eoc-dash-row-color": color } as CSSProperties}>
                    <span className="eoc-dash-row-main">
                      <button type="button" className="eoc-dash-link eoc-dash-row-title" onClick={() => props.onOpenRecord(shelter.id)}>{shelter.name}</button>
                      <span className="eoc-dash-muted">
                        {[stateLabel(shelter.state), ...features.map((field) => `${field.label}: ${{ yes: "yes", no: "no", blank: "not recorded" }[featureAnswer(shelter, field.key)]}`)].join(" · ")}
                      </span>
                    </span>
                    <span className="eoc-shelter-gauge">
                      <ProgressBar compact value={shelter.occupancy} max={shelter.capacity} color={fillColor(shelter)}
                        label={`${shelter.name} occupancy, ${shelter.occupancy} of ${shelter.capacity}${over ? ", over capacity" : ""}`} />
                      <span className={over ? "eoc-dash-pill" : "eoc-dash-muted"}>
                        {shelter.occupancy.toLocaleString()} of {shelter.capacity.toLocaleString()}{over ? ", over capacity" : ""}
                      </span>
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
