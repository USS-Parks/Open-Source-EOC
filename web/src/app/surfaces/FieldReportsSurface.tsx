import { useEffect, useMemo, useState } from "react";
import { choiceLabel, type ViewRecord } from "@openeoc/shared";
import { ActionButton } from "../../design/controls.js";
import { EmptyState } from "../../design/feedback.js";
import { Icon } from "../../design/icons/Icon.js";
import type { ApiClient, BoardListItem } from "../api/client.js";
import type { OperationalPeriodChoice } from "../layout/context.js";
import { PageActions } from "../layout/page-chrome.js";
import { requestMapFocus } from "../layout/map-focus.js";
import { Loading } from "../screens/parts.js";
import "./field-reports.css";

/** The standard board template that field capture, Smart Forms and offline sync write reports to. */
const FIELD_REPORTS_TEMPLATE = "field_reports";
const PAGE_LIMIT = 500;
const MAX_REPORTS = 2000;

type Filter = "unverified" | "verified" | "all";

interface Report {
  readonly id: string;
  readonly summary: string;
  readonly category: string | null;
  readonly verified: boolean;
  readonly photo: string | null;
  readonly point: readonly [number, number] | null;
  readonly createdAt: string | null;
  readonly reporter: string | null;
}

function toReport(record: ViewRecord): Report {
  const location = record.location as { type?: string; coordinates?: unknown } | null | undefined;
  const coordinates = location?.type === "Point" && Array.isArray(location.coordinates) ? location.coordinates : null;
  return {
    id: record.id,
    summary: typeof record.summary === "string" ? record.summary : "",
    category: typeof record.category === "string" ? record.category : null,
    verified: record.verified === true,
    photo: typeof record.photo === "string" && record.photo ? record.photo : null,
    point: coordinates && typeof coordinates[0] === "number" && typeof coordinates[1] === "number"
      ? [coordinates[0], coordinates[1]] : null,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
    reporter: typeof record.createdByName === "string" ? record.createdByName : null,
  };
}

function clock(value: string | null): string {
  if (!value) return "";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

function day(value: string | null): string {
  if (!value) return "";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

/**
 * Field reports as they arrive: the Field Reports board attached to the
 * selected incident, or every Field Reports board in the organization when
 * none is attached. Unverified reports come first; the EOC verifies each one
 * here, finds it on the map, or opens its record on the board.
 */
export function FieldReportsSurface(props: {
  client: ApiClient;
  boards: readonly BoardListItem[];
  boardsLoading: boolean;
  incidentId: string | null;
  incidentBoardIds: ReadonlySet<string>;
  /** The selected operational period; the recent count covers it, or the last hour when none is selected. */
  period: OperationalPeriodChoice | null;
  onOpenSmartForms: () => void;
  onOpenRecord: (boardId: string, recordId: string) => void;
  onOpenMap: () => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const reportBoards = props.boards.filter((board) => board.templateKey === FIELD_REPORTS_TEMPLATE);
  const attached = reportBoards.filter((board) => props.incidentBoardIds.has(board.id));
  const candidates = attached.length > 0 ? attached : reportBoards;
  const board = candidates.find((candidate) => candidate.id === chosen) ?? candidates[0];
  const scoped = board && props.incidentId && props.incidentBoardIds.has(board.id) ? props.incidentId : null;

  const [reports, setReports] = useState<readonly Report[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [filter, setFilter] = useState<Filter>("unverified");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!board) return;
    let active = true;
    setLoadError(null);
    void (async () => {
      const collected: ViewRecord[] = [];
      let cursor: string | null = null;
      do {
        const page = await props.client.boardViewPage(board.id, "all", scoped ? { incidentId: scoped } : {},
          cursor ? { cursor, limit: PAGE_LIMIT } : { limit: PAGE_LIMIT });
        collected.push(...page.records);
        cursor = page.nextCursor;
      } while (cursor && collected.length < MAX_REPORTS);
      if (active) setReports(collected.filter((record) => !record.archivedAt).map(toReport));
    })().catch((cause: unknown) => {
      if (active) setLoadError(cause instanceof Error ? cause.message : "Field reports are unavailable");
    });
    return () => { active = false; };
  }, [board?.id, scoped, generation, props.client]);

  const all = useMemo(() => [...(reports ?? [])].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")), [reports]);
  const unverified = all.filter((report) => !report.verified).length;
  const categories = [...new Set(all.map((report) => report.category).filter((value): value is string => Boolean(value)))].sort();
  const needle = query.trim().toLocaleLowerCase();
  const shown = all.filter((report) =>
    (filter === "all" || (filter === "verified") === report.verified)
    && (!category || report.category === category)
    && (!needle || report.summary.toLocaleLowerCase().includes(needle) || (report.reporter ?? "").toLocaleLowerCase().includes(needle)));
  const selected = all.find((report) => report.id === selectedId) ?? null;
  const [recentFrom, recentTo] = props.period
    ? [Date.parse(props.period.startsAt), Date.parse(props.period.endsAt)]
    : [Date.now() - 3_600_000, Infinity];
  const recent = all.filter((report) => {
    const at = report.createdAt ? Date.parse(report.createdAt) : NaN;
    return at >= recentFrom && at < recentTo;
  }).length;

  async function setVerified(report: Report, verified: boolean) {
    if (!board) return;
    setBusy(true);
    setActionError(null);
    try {
      await props.client.updateRecord(board.id, report.id, { verified }, scoped);
      setReports((current) => current?.map((item) => item.id === report.id ? { ...item, verified } : item) ?? current);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "The report could not be updated");
    } finally {
      setBusy(false);
    }
  }

  function showOnMap(report: Report) {
    if (!report.point) return;
    requestMapFocus({ lon: report.point[0], lat: report.point[1], zoom: 14 });
    props.onOpenMap();
  }

  if (!board) {
    return props.boardsLoading ? <Loading label="Loading field reports…" /> : (
      <EmptyState title="No Field Reports board"
        description="Field reports are kept on a board made from the Field Reports template. Ask an administrator to create one for this organization." />
    );
  }

  return (
    <div className="field-reports">
      <PageActions>
        <button type="button" className="eoc-page-action is-primary" onClick={props.onOpenSmartForms}>
          <Icon name="smartForms" size={16} decorative />Capture a field report
        </button>
      </PageActions>
      <header className="field-reports-head">
        <div>
          <h2>{board.title}</h2>
          <p>Reports from Smart Forms, field capture and offline sync arrive here. Verify each one before it is relied on.</p>
        </div>
        {candidates.length > 1 ? (
          <label className="field-reports-board">
            Field Reports board
            <select value={board.id} onChange={(event) => { setChosen(event.target.value); setReports(null); setSelectedId(null); }}>
              {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
            </select>
          </label>
        ) : null}
      </header>

      {loadError ? <p role="alert" className="field-reports-error">{loadError}</p> : null}
      {!reports && !loadError ? <Loading label="Loading field reports…" /> : null}
      {reports ? (
        <>
          <dl className="field-reports-kpis" aria-label="Field report counts">
            <div><dt>Reports</dt><dd>{all.length}</dd></div>
            <div data-tone={unverified > 0 ? "warning" : undefined}><dt>Unverified</dt><dd>{unverified}</dd></div>
            <div><dt>Verified</dt><dd>{all.length - unverified}</dd></div>
            <div><dt>{props.period ? "This period" : "In the last hour"}</dt><dd>{recent}</dd></div>
            <div><dt>With a photo</dt><dd>{all.filter((report) => report.photo).length}</dd></div>
          </dl>

          <div className="field-reports-toolbar">
            <div className="field-reports-filter" role="group" aria-label="Show reports">
              {([["unverified", `Unverified (${unverified})`], ["verified", `Verified (${all.length - unverified})`], ["all", `All (${all.length})`]] as const)
                .map(([key, label]) => (
                  <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>
                ))}
            </div>
            <label>
              <span>Category</span>
              <select aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">All categories</option>
                {categories.map((value) => <option key={value} value={value}>{choiceLabel(value)}</option>)}
              </select>
            </label>
            <label className="field-reports-search">
              <span>Search</span>
              <input type="search" aria-label="Search reports" placeholder="Summary or reporter" value={query}
                onChange={(event) => setQuery(event.target.value)} />
            </label>
          </div>

          <div className="field-reports-split">
            <section className="field-reports-list" aria-label="Field reports">
              {shown.length === 0 ? (
                <p className="field-reports-empty">
                  {all.length === 0 ? "No field reports yet." : filter === "unverified" && !category && !needle ? "Every report is verified." : "No report matches."}
                </p>
              ) : (
                <ul>
                  {shown.map((report) => (
                    <li key={report.id}>
                      <button type="button" aria-pressed={report.id === selectedId} aria-label={`Report: ${report.summary}`}
                        onClick={() => { setSelectedId(report.id); setActionError(null); }}>
                        <span className="field-reports-time">{clock(report.createdAt)}</span>
                        <span className="field-reports-main">
                          <strong>{report.summary}</strong>
                          <small>{report.reporter ?? "Unknown reporter"}{report.point ? "" : " · no location"}</small>
                        </span>
                        <span className="field-reports-tags">
                          {report.category ? <span className="field-reports-chip" data-category={report.category}>{choiceLabel(report.category)}</span> : null}
                          {report.photo ? <span className="field-reports-chip is-photo">Photo</span> : null}
                          <span className="field-reports-state" data-verified={report.verified || undefined}>{report.verified ? "Verified" : "Unverified"}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="field-reports-detail" aria-label="Selected report">
              {selected ? (
                <>
                  <p className="field-reports-eyebrow">{selected.category ? choiceLabel(selected.category) : "Report"}</p>
                  <h3>{selected.summary}</h3>
                  <dl>
                    <div><dt>Reported</dt><dd>{day(selected.createdAt) || "Unknown"}</dd></div>
                    <div><dt>By</dt><dd>{selected.reporter ?? "Unknown"}</dd></div>
                    <div><dt>Location</dt><dd>{selected.point ? `${selected.point[1].toFixed(5)}, ${selected.point[0].toFixed(5)}` : "Not recorded"}</dd></div>
                    <div><dt>Photo</dt><dd>{selected.photo ? "Attached" : "None"}</dd></div>
                    <div><dt>Status</dt><dd><span className="field-reports-state" data-verified={selected.verified || undefined}>{selected.verified ? "Verified" : "Unverified"}</span></dd></div>
                  </dl>
                  {actionError ? <p role="alert" className="field-reports-error">{actionError}</p> : null}
                  <div className="field-reports-actions">
                    {selected.verified ? (
                      <ActionButton loading={busy} onClick={() => void setVerified(selected, false)}>Mark unverified</ActionButton>
                    ) : (
                      <ActionButton kind="primary" loading={busy} onClick={() => void setVerified(selected, true)}>Verify report</ActionButton>
                    )}
                    <ActionButton disabled={!selected.point} onClick={() => showOnMap(selected)}>Show on map</ActionButton>
                    <ActionButton onClick={() => props.onOpenRecord(board.id, selected.id)}>Open record</ActionButton>
                  </div>
                </>
              ) : (
                <div className="field-reports-placeholder">
                  <Icon name="fieldReports" size={32} decorative />
                  <p>Select a report to verify it, find it on the map, or open its record.</p>
                </div>
              )}
            </section>
          </div>
          <button type="button" className="field-reports-refresh" onClick={() => setGeneration((value) => value + 1)}>Refresh reports</button>
        </>
      ) : null}
    </div>
  );
}
