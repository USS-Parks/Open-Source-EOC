import { Button, StatusBadge } from "../design/components.js";
import { Icon } from "../design/icons/index.js";
import type { FeedHealth } from "../app/api/client.js";

export function FeedReadiness(props: {
  readonly feeds: readonly FeedHealth[];
  readonly isAdmin: boolean;
  readonly busyFeedId: string | null;
  readonly onPoll: (feedId: string) => void;
}) {
  if (props.feeds.length === 0) {
    return <div className="d21-empty"><Icon name="feeds" size={32} decorative /><strong>No feeds configured</strong><span>Add a poll or push feed to begin ingestion.</span></div>;
  }

  return (
    <ul className="d21-readiness-list" aria-label="Feed readiness">
      {props.feeds.map((feed) => {
        const failed = Boolean(feed.lastError);
        const hasLastGood = Boolean(feed.lastSuccessAt);
        const state = !feed.enabled ? "Off"
          : !feed.ingestAuthorized ? "Authorization required"
          : !hasLastGood ? (failed ? "Unavailable" : "Awaiting first update")
            : failed ? "Last-good data" : feed.stale ? "Stale" : "Live";
        const tone = !feed.enabled ? "unknown" : !feed.ingestAuthorized ? "critical" : !hasLastGood
          ? (failed ? "critical" : "info") : failed || feed.stale ? "warning" : "success";
        return (
          <li className="d21-readiness-row" data-feed-state={state.toLowerCase().replaceAll(" ", "-")} key={feed.id}>
            <div className="d21-readiness-title"><Icon name="feeds" size={20} decorative /><div><strong>{feed.name}</strong><span>{feed.kind.toUpperCase()} · {feed.mode}</span></div></div>
            <StatusBadge status={tone}>{state}</StatusBadge>
            <dl className="d21-metrics">
              <div><dt>Stored items</dt><dd>{hasLastGood ? (feed.currentItemCount ?? "—") : "—"}</dd></div>
              <div><dt>Rejected</dt><dd>Unavailable</dd></div>
              <div><dt>Last good</dt><dd>{feed.lastSuccessAt ? formatTime(feed.lastSuccessAt) : "None yet"}</dd></div>
              <div><dt>Freshness window</dt><dd>{formatDuration(feed.staleAfterSeconds)}</dd></div>
              <div><dt>Failures</dt><dd>{feed.consecutiveFailures}</dd></div>
            </dl>
            <p className="d21-muted d21-adapter-note">This adapter accepts a parsed batch or rejects the whole update, so a per-record rejected count is not available.</p>
            {!feed.ingestAuthorized ? <p className="d21-error"><strong>Ingestion authorization expired.</strong> The configured creator is disabled or no longer an administrator. {feed.lastSuccessAt ? "Stored last-good items remain available." : "No usable items have been accepted."}</p> : null}
            {feed.lastError ? <p className="d21-error"><strong>Latest update failed.</strong> {feed.lastError} {feed.lastSuccessAt ? "Stored last-good items remain available." : "No usable items have been accepted."}</p> : null}
            {props.isAdmin && feed.mode === "poll" ? <div className="d21-card-actions"><Button onClick={() => props.onPoll(feed.id)} disabled={props.busyFeedId !== null}>{props.busyFeedId === feed.id ? "Polling…" : "Poll now"}</Button></div> : null}
          </li>
        );
      })}
    </ul>
  );
}

function formatDuration(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400} day${seconds === 86400 ? "" : "s"}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? "" : "s"}`;
  return `${Math.round(seconds / 60)} minutes`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
