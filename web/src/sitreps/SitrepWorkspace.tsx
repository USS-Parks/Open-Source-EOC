import { useEffect, useState } from "react";
import type { ApiClient } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { Button } from "../design/components.js";
import { Icon } from "../design/icons/index.js";
import { EmptyState, ErrorNote, Loading } from "../app/screens/parts.js";
import "./sitreps.css";

export interface SitrepWorkspaceProps {
  readonly client: ApiClient;
  readonly jurisdictionId: string;
  readonly incidentId: string | null;
  readonly incidentName: string | null;
  readonly period: string | null;
  readonly onOpen: (id: string) => void;
  readonly mode?: "sitreps" | "jic";
}

function displayTime(value: string): string {
  return new Date(value).toLocaleString();
}

export function SitrepWorkspace(props: SitrepWorkspaceProps) {
  const [refresh, setRefresh] = useState(0);
  const [period, setPeriod] = useState(props.period ?? "");
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mode = props.mode ?? "sitreps";
  const { data, error, loading } = useAsync(
    () => props.incidentId
      ? props.client.listSitreps(props.jurisdictionId, props.incidentId)
      : Promise.resolve([]),
    [props.jurisdictionId, props.incidentId, refresh],
  );

  useEffect(() => {
    setPeriod(props.period ?? "");
    setComposeError(null);
    setNotice(null);
  }, [props.incidentId, props.period]);

  const compose = async () => {
    if (!props.incidentId || !period.trim()) return;
    setComposing(true);
    setComposeError(null);
    setNotice(null);
    try {
      const result = await props.client.composeSitrep(props.jurisdictionId, {
        incidentId: props.incidentId,
        period: period.trim(),
      });
      setNotice(`Revision ${result.revision ?? 1} frozen for ${period.trim()}.`);
      setRefresh((value) => value + 1);
    } catch (caught) {
      setComposeError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setComposing(false);
    }
  };

  if (!props.incidentId) {
    return (
      <div className="eoc-sitrep-workspace">
        <EmptyState
          label={mode === "jic" ? "Select an incident before preparing JIC material." : "Select an incident to compose a situation report."}
          hint="SITREPs and JIC drafts stay bound to the selected incident."
        />
      </div>
    );
  }
  if (loading && !data) return <Loading label="Loading incident situation reports…" />;

  const reports = data ?? [];
  return (
    <section className="eoc-sitrep-workspace" aria-labelledby="sitrep-workspace-title">
      <header className="eoc-sitrep-page-heading">
        <span className="eoc-sitrep-heading-icon" aria-hidden="true">
          <Icon decorative name={mode === "jic" ? "jic" : "sitrep"} size={32} />
        </span>
        <div>
          <span className="eoc-sitrep-eyebrow">{mode === "jic" ? "Joint Information Center" : "Planning · frozen record"}</span>
          <h2 id="sitrep-workspace-title">{mode === "jic" ? "JIC preparation" : "Situation reports"}</h2>
          <p>{props.incidentName ?? "Selected incident"} · internal operational material</p>
        </div>
      </header>

      {mode === "sitreps" ? (
        <section className="eoc-sitrep-compose" aria-label="Compose a frozen situation report">
          <div>
            <h3>Compose from current incident sources</h3>
            <p>Captures the readable Lifeline, ESF, board, event, talking-point, and rumor state. The archived result will not move when sources change.</p>
          </div>
          <label>
            Operational period
            <input value={period} onChange={(event) => setPeriod(event.target.value)} maxLength={160} />
          </label>
          <Button kind="primary" onClick={() => void compose()} disabled={composing || !period.trim()}>
            {composing ? "Composing…" : "Compose and freeze"}
          </Button>
        </section>
      ) : (
        <div className="eoc-sitrep-callout">
          Open a frozen SITREP to prepare a controlled JIC draft. Drafting and review do not publish it.
        </div>
      )}

      {composeError ? <ErrorNote message={composeError} /> : null}
      {error ? <ErrorNote message={error} /> : null}
      {notice ? <p className="eoc-sitrep-notice" role="status">{notice}</p> : null}

      <section aria-labelledby="sitrep-archive-title">
        <div className="eoc-sitrep-section-heading">
          <div>
            <span className="eoc-sitrep-eyebrow">Selected incident</span>
            <h3 id="sitrep-archive-title">Frozen briefing archive</h3>
          </div>
          <span>{reports.length} report{reports.length === 1 ? "" : "s"}</span>
        </div>
        {reports.length === 0 ? (
          <EmptyState
            label="No situation reports for this incident."
            hint={mode === "jic" ? "Compose a SITREP first, then return here to prepare public information." : "Compose the first report from the current incident picture."}
          />
        ) : (
          <ol className="eoc-sitrep-archive">
            {reports.map((report) => (
              <li key={report.id}>
                <button type="button" onClick={() => props.onOpen(report.id)}>
                  <span className="eoc-sitrep-revision">Revision {report.revision}</span>
                  <strong>{report.period}</strong>
                  <span>{report.incidentName ?? props.incidentName}</span>
                  <small>Sources through {displayTime(report.sourceTime)}</small>
                  <small>Frozen {displayTime(report.composedAt)} by {report.composedBy}</small>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
      <footer className="eoc-sitrep-fouo">
        <Icon decorative name="source" size={20} />
        FOUO · Authorized operational use. A frozen briefing or JIC draft is not a public release.
      </footer>
    </section>
  );
}
