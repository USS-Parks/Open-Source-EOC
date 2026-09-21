import { useState } from "react";
import { Button, Panel, StatusBadge, type Status } from "../../design/components.js";
import type { ApiClient, IapListItem } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { EmptyState, Loading, Scroll, SurfaceHeader } from "../screens/parts.js";

/**
 * The IAP working list (F5, VEOC-71). WebEOC's Incident Action Plan module is
 * a table of plans by operational period, each with a status, a progress bar,
 * and who prepared and approved it, with count chips across the top. This is
 * that view over the platform's own IAPs: the five-state workflow (not started,
 * in progress, in approval, approved, complete) drives the status, and the
 * assembled forms against the standard set drive the progress bar. Plans are
 * built in the ICS Forms surface; here they are advanced through approval.
 */

const STATUS_ORDER = ["not_started", "in_progress", "in_approval", "approved", "complete"] as const;

const STATUS_LABEL: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  in_approval: "In Approval",
  approved: "Approved",
  complete: "Complete",
};

const STATUS_TONE: Record<string, Status> = {
  not_started: "unknown",
  in_progress: "info",
  in_approval: "warning",
  approved: "success",
  complete: "success",
};

function ProgressBar(props: { value: number; target: number }) {
  const pct = props.target > 0 ? Math.min(100, Math.round((props.value / props.target) * 100)) : 0;
  return (
    <div style={{ minWidth: 140 }}>
      <div
        role="img"
        aria-label={`${props.value} of ${props.target} forms (${pct}%)`}
        style={{
          height: 8,
          borderRadius: 4,
          background: "var(--eoc-border)",
          overflow: "hidden",
        }}
      >
        <div style={{ height: "100%", width: `${pct}%`, background: "var(--eoc-status-info)" }} />
      </div>
      <span style={{ fontSize: 12, color: "var(--eoc-text-muted)" }}>
        {props.value} / {props.target} forms ({pct}%)
      </span>
    </div>
  );
}

function Chip(props: { label: string }) {
  return (
    <span
      style={{
        fontSize: 12,
        color: "var(--eoc-text-muted)",
        border: "1px solid var(--eoc-border)",
        borderRadius: 999,
        padding: "1px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {props.label}
    </span>
  );
}

function IapRow(props: {
  iap: IapListItem;
  isAdmin: boolean;
  busy: boolean;
  onSubmit: (id: string) => void;
  onApprove: (id: string) => void;
  onComplete: (id: string) => void;
  onDownload: (id: string, op: string) => void;
}) {
  const s = props.iap.status;
  const canSubmit = s === "not_started" || s === "in_progress";
  const canApprove = props.isAdmin && (s === "not_started" || s === "in_progress" || s === "in_approval");
  const canComplete = props.isAdmin && s === "approved";
  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "120px 1fr 170px auto",
        gap: 12,
        alignItems: "center",
        padding: "10px",
        border: "1px solid var(--eoc-border)",
        borderRadius: 6,
      }}
    >
      <StatusBadge status={STATUS_TONE[s] ?? "unknown"}>{STATUS_LABEL[s] ?? s}</StatusBadge>
      <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
        <strong>{props.iap.operationalPeriod || "(no operational period)"}</strong>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Chip label={`Prepared by ${props.iap.preparedBy ?? "unassigned"}`} />
          {props.iap.approvedBy ? <Chip label={`Approved by ${props.iap.approvedBy}`} /> : null}
        </div>
      </div>
      <ProgressBar value={props.iap.formCount} target={props.iap.targetForms} />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {canSubmit ? (
          <Button onClick={() => props.onSubmit(props.iap.id)} disabled={props.busy}>
            Submit for approval
          </Button>
        ) : null}
        {canApprove ? (
          <Button kind="primary" onClick={() => props.onApprove(props.iap.id)} disabled={props.busy}>
            Approve
          </Button>
        ) : null}
        {canComplete ? (
          <Button onClick={() => props.onComplete(props.iap.id)} disabled={props.busy}>
            Mark complete
          </Button>
        ) : null}
        <Button
          onClick={() => props.onDownload(props.iap.id, props.iap.operationalPeriod)}
          disabled={props.busy}
        >
          PDF
        </Button>
      </div>
    </li>
  );
}

export function IapSurface(props: { client: ApiClient; incidentId: string | null; isAdmin: boolean }) {
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = props.incidentId;
  const iaps = useAsync(
    () => (active ? props.client.listIaps(active) : Promise.resolve([] as IapListItem[])),
    [active, reload],
  );

  if (!active)
    return (
      <EmptyState
        label="No incident selected."
        hint="Choose an incident in the command bar, assemble its IAP in the ICS Forms surface, then manage it here."
      />
    );

  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    fn()
      .then(() => setReload((n) => n + 1))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const download = (id: string, op: string) => {
    setBusy(true);
    setError(null);
    props.client
      .downloadIapPdf(id)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `iap-${op.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "op"}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const rows = iaps.data ?? [];
  const counts = STATUS_ORDER.map((s) => ({
    status: s,
    n: rows.filter((r) => r.status === s).length,
  }));

  return (
    <Scroll>
      <SurfaceHeader title="Incident Action Plans" />
      <div style={{ display: "grid", gap: 16, maxWidth: 980 }}>
        <Panel title="Plans by status">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {counts.map((c) => (
              <span key={c.status} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <StatusBadge status={STATUS_TONE[c.status] ?? "unknown"}>
                  {STATUS_LABEL[c.status]}
                </StatusBadge>
                <strong>{c.n}</strong>
              </span>
            ))}
          </div>
        </Panel>

        <Panel title="Working list">
          {iaps.loading && !iaps.data ? <Loading label="Loading plans…" /> : null}
          {iaps.data && rows.length === 0 ? (
            <p style={{ color: "var(--eoc-text-muted)", margin: 0 }}>
              No IAPs for this incident yet. Assemble one in the ICS Forms surface.
            </p>
          ) : null}
          {rows.length > 0 ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
              {rows.map((iap) => (
                <IapRow
                  key={iap.id}
                  iap={iap}
                  isAdmin={props.isAdmin}
                  busy={busy}
                  onSubmit={(id) => run(() => props.client.submitIap(id))}
                  onApprove={(id) => run(() => props.client.approveIap(id))}
                  onComplete={(id) => run(() => props.client.completeIap(id))}
                  onDownload={download}
                />
              ))}
            </ul>
          ) : null}
          {error ? (
            <p role="alert" style={{ color: "var(--eoc-status-critical)", margin: "8px 0 0" }}>
              {error}
            </p>
          ) : null}
        </Panel>
      </div>
    </Scroll>
  );
}
