import { useEffect, useRef, useState } from "react";
import type {
  ImpactCategory,
  ImpactCategoryAggregate,
  ImpactContribution,
  ImpactContributionPage,
  ImpactSourceAggregate,
  IncidentImpactAnalysis,
  IncidentImpactComparison,
  ViewportBbox,
} from "@openeoc/shared";
import { KpiCard, type KpiValue } from "../design/cards.js";
import "./impact-kpis.css";

export interface ImpactKpiClient {
  getIncidentImpact(incidentId: string, bbox?: ViewportBbox): Promise<IncidentImpactAnalysis>;
  getImpactContributions(
    incidentId: string,
    datasetId: string,
    options: {
      revision: number;
      bbox?: ViewportBbox;
      cursor?: string;
      limit?: number;
    },
  ): Promise<ImpactContributionPage>;
  /** Category totals at two area revisions; without it the panel offers no comparison. */
  compareIncidentImpact?(
    incidentId: string,
    fromRevision: number,
    toRevision: number,
    bbox?: ViewportBbox,
  ): Promise<IncidentImpactComparison>;
}

const CATEGORIES: readonly ImpactCategory[] = [
  "structures_parcels",
  "infrastructure_facilities",
  "shelters",
  "closures",
  "population",
];

const LABELS: Readonly<Record<ImpactCategory, string>> = {
  structures_parcels: "Affected structures / parcels",
  infrastructure_facilities: "Affected facilities",
  shelters: "Shelters in scope",
  closures: "Closures in scope",
  population: "Population exposure",
};

function bboxKey(bbox: ViewportBbox | undefined): string {
  return bbox?.join(",") ?? "incident-area";
}

function scopeLabel(analysis: IncidentImpactAnalysis): string {
  const scope = analysis.impact.scope;
  if (!scope) return "Server scope unavailable";
  return scope.kind === "viewport" ? "Current map viewport" : "Incident area";
}

function valueFor(category: ImpactCategoryAggregate): KpiValue {
  if (category.availability === "stale") return { kind: "stale" };
  if (category.availability === "unavailable") return { kind: "unavailable" };
  if (category.value !== null) {
    const unit = category.unit === "people" ? "people" : "records";
    if (category.value === 0) return { kind: "zero", unit };
    return {
      kind: "value",
      value: new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(category.value),
      unit,
    };
  }
  return { kind: "unknown" };
}

function categoryDetail(category: ImpactCategoryAggregate, analysis: IncidentImpactAnalysis): string {
  const detail = [
    scopeLabel(analysis),
    `coverage ${category.coverage}`,
    `availability ${category.availability}`,
  ];
  if (category.reason) detail.push(category.reason);
  return detail.join(" · ");
}

function signed(value: number | null): string {
  if (value === null) return "unknown";
  const text = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
  return value > 0 ? `+${text}` : text;
}

/** Totals at an earlier area revision against the one in view, in the same scope. */
function ImpactComparison(props: {
  client: ImpactKpiClient;
  incidentId: string;
  analysis: IncidentImpactAnalysis;
}) {
  const current = props.analysis.impact.areaRevision;
  const [from, setFrom] = useState(current && current > 1 ? String(current - 1) : "");
  const [result, setResult] = useState<IncidentImpactComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const compare = props.client.compareIncidentImpact?.bind(props.client);
  if (!compare || !current || current < 2) return null;
  const scope = props.analysis.impact.scope;
  const run = () => {
    const revision = Number(from);
    if (!Number.isInteger(revision) || revision < 1 || revision >= current) {
      setError(`Enter an earlier area revision, from 1 to ${current - 1}.`);
      return;
    }
    setError(null);
    compare(props.incidentId, revision, current, scope?.kind === "viewport" ? scope.bbox : undefined)
      .then(setResult)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  };
  return (
    <section className="eoc-impact-records" aria-label="Impact comparison">
      <label>Compare with area revision{" "}
        <input inputMode="numeric" size={4} value={from} onChange={(event) => setFrom(event.target.value)} />
      </label>{" "}
      <button type="button" onClick={run}>Compare</button>
      {error ? <p role="alert" className="eoc-impact-error">{error}</p> : null}
      {result ? <>
        <h4>Revision {result.fromRevision} to {result.toRevision}</h4>
        <ol>
          {CATEGORIES.map((key) => {
            const delta = result.categories[key];
            return <li key={key}>
              <span>{LABELS[key]}: {signed(delta.delta)}</span>
              <small>{delta.fromValue ?? "unknown"} then {delta.toValue ?? "unknown"} · {delta.explanation}</small>
            </li>;
          })}
        </ol>
        <p className="eoc-impact-interpretation">Both revisions use the datasets loaded now; this is not a historical snapshot.</p>
      </> : null}
    </section>
  );
}

function recordLabel(record: ImpactContribution): string {
  for (const key of ["name", "title", "road", "address", "facility", "status"]) {
    const value = record.data[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return record.sourceId;
}

function SourceProvenance(props: {
  source: ImpactSourceAggregate;
  canDrill: boolean;
  onDrill: () => void;
}) {
  const source = props.source;
  return (
    <article className="eoc-impact-source">
      <header>
        <div>
          <h4>{source.datasetName}</h4>
          <p>{source.owner} · {source.license}</p>
        </div>
        {props.canDrill ? (
          <button type="button" onClick={props.onDrill}>
            View contributing records
          </button>
        ) : null}
      </header>
      <dl>
        <div><dt>Availability</dt><dd>{source.availability}</dd></div>
        <div><dt>Coverage</dt><dd>{source.coverage}</dd></div>
        <div><dt>Loaded</dt><dd>{source.loadedAt ?? "Unknown"}</dd></div>
        <div><dt>Source vintage</dt><dd>{source.sourceVintage ?? "Unknown"}</dd></div>
      </dl>
      {source.reason ? <p className="eoc-impact-reason">{source.reason}</p> : null}
    </article>
  );
}

export function ImpactKpiPanel(props: {
  client: ImpactKpiClient;
  incidentId: string;
  bbox: ViewportBbox | null;
}) {
  const [analysis, setAnalysis] = useState<IncidentImpactAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<ImpactCategory | null>(null);
  const [drillSource, setDrillSource] = useState<ImpactSourceAggregate | null>(null);
  const [records, setRecords] = useState<readonly ImpactContribution[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [drillError, setDrillError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const drillSequence = useRef(0);
  const key = props.bbox ? bboxKey(props.bbox) : "";

  useEffect(() => {
    if (!props.bbox) return;
    const sequence = ++requestSequence.current;
    ++drillSequence.current;
    setLoading(true);
    setAnalysis(null);
    setError(null);
    setSelectedCategory(null);
    setDrillSource(null);
    setRecords([]);
    setNextCursor(null);
    void props.client.getIncidentImpact(props.incidentId, props.bbox)
      .then((next) => {
        if (requestSequence.current === sequence) setAnalysis(next);
      })
      .catch((reason: unknown) => {
        if (requestSequence.current === sequence) {
          setAnalysis(null);
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (requestSequence.current === sequence) setLoading(false);
      });
  }, [props.client, props.incidentId, props.bbox, key]);

  const loadRecords = (source: ImpactSourceAggregate, cursor?: string) => {
    if (!analysis || analysis.impact.areaRevision === null || !source.datasetId) return;
    const sequence = ++drillSequence.current;
    const revision = analysis.impact.areaRevision;
    const scopeBbox = analysis.impact.scope?.kind === "viewport"
      ? analysis.impact.scope.bbox
      : undefined;
    setDrillError(null);
    void props.client.getImpactContributions(props.incidentId, source.datasetId, {
      revision,
      ...(scopeBbox ? { bbox: scopeBbox } : {}),
      ...(cursor ? { cursor } : {}),
      limit: 50,
    }).then((page) => {
      if (drillSequence.current !== sequence) return;
      if (page.areaRevision !== revision || bboxKey(page.scope?.bbox ?? undefined) !== bboxKey(scopeBbox)) {
        setDrillError("The analysis scope changed. Refresh the viewport before continuing.");
        return;
      }
      setRecords((current) => cursor ? [...current, ...page.records] : page.records);
      setNextCursor(page.nextCursor);
    }).catch((reason: unknown) => {
      if (drillSequence.current === sequence) {
        setDrillError(reason instanceof Error ? reason.message : String(reason));
      }
    });
  };

  const selected = selectedCategory && analysis
    ? analysis.impact.categories[selectedCategory]
    : null;
  const resolvedBbox = analysis?.impact.scope?.kind === "viewport"
    ? bboxKey(analysis.impact.scope.bbox)
    : analysis?.impact.scope?.kind === "incident-area"
      ? "incident-area"
      : null;
  const placeholderDetail = error
    ? "Impact analysis unavailable"
    : props.bbox
      ? "Updating current map viewport"
      : "Waiting for the map viewport";

  return (
    <section
      className="eoc-impact-kpis"
      aria-label="Map impact indicators"
      aria-busy={loading}
      {...(resolvedBbox ? { "data-analysis-bbox": resolvedBbox } : {})}
    >
      <header className="eoc-impact-header">
        <div>
          <h2>Impact in view</h2>
          <p>
            {analysis
              ? `${scopeLabel(analysis)} · area revision ${analysis.impact.areaRevision ?? "unknown"}`
              : placeholderDetail}
          </p>
        </div>
      </header>
      <div className="eoc-impact-message">
        {error ? <span role="alert" className="eoc-impact-error">{error}</span>
          : loading ? <span role="status">Updating…</span>
            : <span aria-hidden="true">&nbsp;</span>}
      </div>
      {/* The strip scrolls sideways on a narrow screen, so the keyboard can reach it. */}
      <div className="eoc-impact-strip" role="group" aria-label="Impact indicator cards" tabIndex={0}>
        {CATEGORIES.map((categoryKey) => {
          const category = analysis?.impact.categories[categoryKey];
          return (
            <KpiCard
              key={categoryKey}
              label={LABELS[categoryKey]}
              value={category ? valueFor(category) : { kind: "unknown" }}
              detail={category && analysis ? categoryDetail(category, analysis) : placeholderDetail}
              {...(category && category.sources.length > 0 ? { action: {
                label: "Sources",
                onClick: () => {
                  ++drillSequence.current;
                  setSelectedCategory(categoryKey);
                  setDrillSource(null);
                  setRecords([]);
                  setNextCursor(null);
                  setDrillError(null);
                },
              } } : {})}
              data-testid={`impact-kpi-${categoryKey}`}
            />
          );
        })}
      </div>
      <p className="eoc-impact-interpretation">
        Geographic exposure does not set lifeline condition. Lifeline status remains based on reported incident records.
      </p>
      {analysis ? <ImpactComparison key={`${analysis.impact.areaRevision}:${resolvedBbox}`} client={props.client}
        incidentId={props.incidentId} analysis={analysis} /> : null}
      {selected && analysis ? (
        <aside className="eoc-impact-drill" aria-label={`${LABELS[selected.category]} sources`}>
          <header>
            <div>
              <h3>{LABELS[selected.category]}</h3>
              <p>{categoryDetail(selected, analysis)}</p>
            </div>
            <button type="button" onClick={() => setSelectedCategory(null)} aria-label="Close impact sources">Close</button>
          </header>
          {selected.reason ? <p className="eoc-impact-reason">{selected.reason}</p> : null}
          <div className="eoc-impact-source-list">
            {selected.sources.map((source) => (
              <SourceProvenance
                key={source.catalogSourceId}
                source={source}
                canDrill={source.datasetId !== null && analysis.impact.areaRevision !== null}
                onDrill={() => {
                  setDrillSource(source);
                  setRecords([]);
                  setNextCursor(null);
                  loadRecords(source);
                }}
              />
            ))}
          </div>
          {drillSource ? (
            <section className="eoc-impact-records" aria-label={`${drillSource.datasetName} contributing records`}>
              <h4>{drillSource.datasetName} contributing records</h4>
              {drillError ? <p role="alert" className="eoc-impact-error">{drillError}</p> : null}
              <ol>
                {records.map((record) => (
                  <li key={record.sourceId}>
                    <span>{recordLabel(record)}</span>
                    <small>{record.sourceId} · contribution {record.value}</small>
                  </li>
                ))}
              </ol>
              {nextCursor ? (
                <button type="button" onClick={() => loadRecords(drillSource, nextCursor)}>Load more</button>
              ) : records.length > 0 ? <p>All contributing records loaded.</p> : null}
            </section>
          ) : null}
        </aside>
      ) : null}
    </section>
  );
}
