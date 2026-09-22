import type { DatasetStatus } from "@openeoc/shared";
import { Button, StatusBadge, type Status } from "../design/components.js";
import { Icon } from "../design/icons/index.js";
import { formatDuration, formatTime } from "./format.js";

const TONE: Record<DatasetStatus["availability"], Status> = {
  available: "success",
  stale: "warning",
  awaiting: "info",
  unavailable: "critical",
};

const LABEL: Record<DatasetStatus["availability"], string> = {
  available: "Usable",
  stale: "Last-good data",
  awaiting: "Registered · awaiting ingestion",
  unavailable: "Unavailable",
};

export function DatasetReadiness(props: {
  readonly datasets: readonly DatasetStatus[];
  readonly loading: boolean;
  readonly onRefresh: () => void;
}) {
  if (props.datasets.length === 0) {
    return (
      <div className="d21-empty">
        <Icon name="datasets" size={32} decorative />
        <strong>No datasets onboarded</strong>
        <span>A catalog registration or data pack will appear here before its first ingest. Registration alone is not usable data.</span>
        <Button onClick={props.onRefresh} disabled={props.loading}>{props.loading ? "Checking…" : "Check readiness"}</Button>
      </div>
    );
  }

  return (
    <>
      <ul className="d21-readiness-list" aria-label="Onboarded dataset readiness">
        {props.datasets.map((dataset) => {
          const lastGood = dataset.lastSuccessAt ? formatTime(dataset.lastSuccessAt) : "None yet";
          const accepted = dataset.lastReceived === null || dataset.lastReceived === undefined || dataset.lastRejected === null || dataset.lastRejected === undefined
            ? null : dataset.lastReceived - dataset.lastRejected;
          return (
            <li className="d21-readiness-row" data-availability={dataset.availability} key={dataset.id}>
              <div className="d21-readiness-title">
                <Icon name="datasets" size={20} decorative />
                <div><strong>{dataset.name}</strong><span>{dataset.organizationName} · {dataset.kind.toUpperCase()}</span></div>
              </div>
              <StatusBadge status={TONE[dataset.availability]}>{LABEL[dataset.availability]}</StatusBadge>
              <dl className="d21-metrics">
                <div><dt>Stored items</dt><dd>{dataset.itemCount ?? "—"}</dd></div>
                <div><dt>Last-good accepted</dt><dd>{accepted ?? "—"}</dd></div>
                <div><dt>Last-good rejected</dt><dd>{dataset.lastRejected ?? "—"}</dd></div>
                <div><dt>Last good</dt><dd>{lastGood}</dd></div>
                <div><dt>Fresh for</dt><dd>{formatDuration(dataset.staleAfterSeconds)}</dd></div>
                <div><dt>Coverage</dt><dd>{dataset.coverageArea === null ? "Not supplied" : "Defined"}</dd></div>
              </dl>
              {dataset.reason ? <p className="d21-error"><strong>Latest update failed.</strong> {dataset.reason} {dataset.itemCount !== null ? "Stored last-good items remain available." : "No usable data has been ingested."}</p> : null}
            </li>
          );
        })}
      </ul>
      <div className="d21-toolbar"><Button onClick={props.onRefresh} disabled={props.loading}>{props.loading ? "Checking…" : "Refresh readiness"}</Button></div>
    </>
  );
}
