import { CAP_CATEGORY, CAP_CERTAINTY, CAP_SCOPE, CAP_SEVERITY, CAP_URGENCY } from "@openeoc/shared";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ActionButton, Tabs } from "../../design/controls.js";
import { Drawer } from "../../design/overlays.js";
import { ErrorNote, Loading } from "../screens/parts.js";
import { useAsync, usePolled } from "../data/hooks.js";
import type {
  AlertReviewState,
  AlertTransmission,
  CapAlertDetail,
  CapAlertSummary,
  CapDraft,
  RawNotification,
} from "../api/client.js";
import "../../notifications/notifications.css";

export interface AlertsClient {
  notifications(): Promise<RawNotification[]>;
  markNotificationRead(id: string): Promise<{ ok: true }>;
  acknowledgeNotification(id: string): Promise<{ ok: true; acknowledged_at: string; acknowledged_by: string }>;
  listCapAlerts(jurisdictionId: string): Promise<CapAlertSummary[]>;
  getCapAlert(id: string): Promise<CapAlertDetail>;
  createCapDraft(jurisdictionId: string, alert: CapDraft, incidentId?: string): Promise<{ id: string }>;
  reviewCapAlert(id: string, state: AlertReviewState): Promise<{ revision: number; state: AlertReviewState; actorName: string; createdAt: string }>;
}

export interface AlertsSurfaceProps {
  readonly client: AlertsClient;
  readonly jurisdictionId: string;
  readonly incidentId: string | null;
  readonly canAuthor: boolean;
  readonly actorEmail: string;
}

type InboxFilter = "all" | "unread" | "unacknowledged" | "failed";
type AlertFilter = "all" | "draft" | "in_review" | "approved" | "exercise" | "received";
type DraftKind = "Draft" | "Exercise" | "Test";

interface DraftValues {
  readonly kind: DraftKind;
  readonly sender: string;
  readonly scope: "Public" | "Restricted" | "Private";
  readonly addresses: string;
  readonly category: (typeof CAP_CATEGORY)[number];
  readonly event: string;
  readonly headline: string;
  readonly description: string;
  readonly instruction: string;
  readonly urgency: (typeof CAP_URGENCY)[number];
  readonly severity: (typeof CAP_SEVERITY)[number];
  readonly certainty: (typeof CAP_CERTAINTY)[number];
}

function initialDraft(sender: string): DraftValues {
  return {
    kind: "Draft",
    sender,
    scope: "Public",
    addresses: "",
    category: "Safety",
    event: "",
    headline: "",
    description: "",
    instruction: "",
    urgency: "Unknown",
    severity: "Unknown",
    certainty: "Unknown",
  };
}

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Not recorded";
}

function channelLabel(channel: string): string {
  const labels: Record<string, string> = {
    inapp: "Board rule",
    workflow: "Workflow routing",
    cap: "CAP alert store",
    collab: "Collaboration service",
    feed: "Data feed",
    resource: "Resource coordination",
    briefing: "Briefing schedule",
    webhook: "Webhook delivery",
    ntfy: "Push delivery",
  };
  return labels[channel] ?? channel;
}

function notificationState(item: RawNotification): { readonly key: string; readonly label: string } {
  if (!item.assigned_to_current_actor) {
    return { key: "delivery", label: item.status === "failed" ? "Delivery failed" : "Delivery log" };
  }
  if (item.acknowledged_at) return { key: "acknowledged", label: "Acknowledged" };
  if (item.read_at) return { key: "read", label: "Read" };
  return { key: "unread", label: "Unread" };
}

function transmissionLabel(transmission: AlertTransmission): string {
  if (transmission.state === "not_attempted") return "No workspace outbound attempt recorded";
  const outcome = transmission.state === "accepted" ? "Accepted by IPAWS" : "Rejected by IPAWS";
  return `${outcome} · ${transmission.environment ?? "environment not recorded"} · ${formatTime(transmission.submittedAt)}`;
}

function urgencyLabel(item: RawNotification): string {
  if (item.status === "failed") return "Delivery failed";
  const urgency = item.detail.urgency;
  return typeof urgency === "string" ? urgency : "Not specified";
}

function reviewLabel(item: CapAlertSummary | CapAlertDetail): string {
  const status = "alert" in item ? item.alert.status : item.status;
  const exercise = status === "Exercise" || status === "Test" ? `${status} · ` : "";
  if (item.review) {
    if (item.review.state === "in_review") return `${exercise}In review`;
    if (item.review.state === "approved") return `${exercise}Approved locally`;
    return `${exercise}Local draft`;
  }
  return item.origin === "ingested" ? "Received external alert" : `${exercise}Stored alert`;
}

function draftFrom(values: DraftValues): CapDraft {
  return {
    sender: values.sender.trim(),
    status: values.kind,
    msgType: "Alert",
    scope: values.scope,
    ...(values.scope === "Private" ? { addresses: values.addresses.trim() } : {}),
    info: [{
      language: "en-US",
      category: [values.category],
      event: values.event.trim(),
      urgency: values.urgency,
      severity: values.severity,
      certainty: values.certainty,
      headline: values.headline.trim(),
      description: values.description.trim(),
      instruction: values.instruction.trim(),
    }],
  };
}

function NotificationDetail(props: {
  readonly item: RawNotification | null;
  readonly actionError: string | null;
  readonly acknowledging: boolean;
  readonly onAcknowledge: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (props.item) heading.current?.focus(); }, [props.item?.id]);
  if (!props.item) return <div className="notification-empty-detail"><strong>Select a notification</strong><p>Opening an item marks it read. Acknowledgement remains a separate action.</p></div>;
  const item = props.item;
  const canAcknowledge = item.assigned_to_current_actor;
  return (
    <article className="notification-detail" aria-labelledby="notification-detail-title">
      <header>
        <div>
          <span className="notification-eyebrow">{channelLabel(item.channel)}</span>
          <h2 id="notification-detail-title" ref={heading} tabIndex={-1}>{item.title}</h2>
        </div>
        <span className="notification-state" data-state={notificationState(item).key}>
          {notificationState(item).label}
        </span>
      </header>
      <p className="notification-detail-body">{item.body || "No additional message."}</p>
      <dl className="notification-facts">
        <div><dt>Urgency</dt><dd>{urgencyLabel(item)}</dd></div>
        <div><dt>Incident</dt><dd>{item.incident_name ?? "Not linked"}</dd></div>
        <div><dt>Source</dt><dd>{channelLabel(item.channel)}</dd></div>
        <div><dt>Destination</dt><dd>{item.destination}</dd></div>
        <div><dt>Received</dt><dd>{formatTime(item.created_at)}</dd></div>
        <div><dt>Delivery</dt><dd>{item.status === "failed" ? "Failed" : "Delivered"}</dd></div>
        <div><dt>Read</dt><dd>{formatTime(item.read_at)}</dd></div>
        <div><dt>Acknowledged</dt><dd>{item.acknowledged_at ? `${formatTime(item.acknowledged_at)} by ${item.acknowledged_by_name ?? "assigned operator"}` : "Not acknowledged"}</dd></div>
      </dl>
      {props.actionError ? <p role="alert" className="notification-error">{props.actionError}</p> : null}
      <footer>
        {item.acknowledged_at ? (
          <p className="notification-muted">Acknowledgement records receipt; it does not resolve the underlying work.</p>
        ) : canAcknowledge ? (
          <ActionButton kind="primary" loading={props.acknowledging} loadingLabel="Acknowledging…" onClick={props.onAcknowledge}>
            Acknowledge notification
          </ActionButton>
        ) : (
          <p className="notification-muted">This delivery log is not assigned for acknowledgement.</p>
        )}
      </footer>
    </article>
  );
}

function AlertDetail(props: {
  readonly summary: CapAlertSummary | null;
  readonly detail: CapAlertDetail | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly canAuthor: boolean;
  readonly reviewing: boolean;
  readonly onReview: (state: AlertReviewState) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (props.summary) heading.current?.focus(); }, [props.summary?.id]);
  if (!props.summary) return <div className="notification-empty-detail"><strong>Select an alert record</strong><p>Alert records are stored locally. No external destination is contacted here.</p></div>;
  if (props.loading && !props.detail) return <Loading label="Loading alert detail…" />;
  if (props.error && !props.detail) return <ErrorNote message={props.error} />;
  if (!props.detail) return null;
  const { alert } = props.detail;
  const info = alert.info[0];
  const state = props.detail.review?.state ?? null;
  return (
    <article className="notification-detail alert-record-detail" aria-labelledby="alert-record-title">
      <header>
        <div>
          <span className="notification-eyebrow">{props.detail.origin === "ingested" ? "Received externally" : "Local CAP record"}</span>
          <h2 id="alert-record-title" ref={heading} tabIndex={-1}>{info?.headline ?? info?.event ?? alert.identifier}</h2>
        </div>
        <span className="notification-state" data-state={alert.status === "Exercise" || alert.status === "Test" ? "exercise" : state ?? "stored"}>
          {reviewLabel(props.detail)}
        </span>
      </header>
      <p className="notification-detail-body">{info?.description ?? "No description supplied."}</p>
      <dl className="notification-facts">
        <div><dt>CAP status</dt><dd>{alert.status}</dd></div>
        <div><dt>Urgency</dt><dd>{info?.urgency ?? "Unknown"}</dd></div>
        <div><dt>Severity</dt><dd>{info?.severity ?? "Unknown"}</dd></div>
        <div><dt>Source</dt><dd>{alert.source ?? alert.sender}</dd></div>
        <div><dt>Intended audience</dt><dd>{alert.scope}{alert.addresses ? ` · ${alert.addresses}` : ""}</dd></div>
        <div><dt>Stored</dt><dd>{formatTime(props.detail.createdAt)}</dd></div>
        <div><dt>Workspace outbound history</dt><dd>{transmissionLabel(props.detail.transmission)}</dd></div>
        <div><dt>IPAWS profile</dt><dd>{props.detail.ipawsEligible ? "Eligible if separately authorized" : "Not eligible"}</dd></div>
      </dl>
      {info?.instruction ? <section className="notification-instruction"><h3>Instruction</h3><p>{info.instruction}</p></section> : null}
      {props.error ? <p role="alert" className="notification-error">{props.error}</p> : null}
      <footer className="notification-actions">
        {props.canAuthor && state === "draft" ? <ActionButton kind="primary" loading={props.reviewing} onClick={() => props.onReview("in_review")}>Submit for local review</ActionButton> : null}
        {props.canAuthor && state === "in_review" ? <>
          <ActionButton kind="primary" loading={props.reviewing} onClick={() => props.onReview("approved")}>Approve local alert</ActionButton>
          <ActionButton loading={props.reviewing} onClick={() => props.onReview("draft")}>Return to draft</ActionButton>
        </> : null}
        {state === "approved" ? <p className="notification-muted">Approved locally. Approval does not transmit this alert.</p> : null}
      </footer>
    </article>
  );
}

function AlertComposer(props: {
  readonly open: boolean;
  readonly client: AlertsClient;
  readonly jurisdictionId: string;
  readonly incidentId: string | null;
  readonly actorEmail: string;
  readonly onClose: () => void;
  readonly onSaved: (id: string) => void;
}) {
  const [values, setValues] = useState<DraftValues>(() => initialDraft(props.actorEmail));
  const [reviewing, setReviewing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!props.open) return;
    setValues(initialDraft(props.actorEmail));
    setReviewing(false);
    setDirty(false);
    setSaving(false);
    setError(null);
  }, [props.open, props.actorEmail, props.jurisdictionId, props.incidentId]);

  function change<K extends keyof DraftValues>(key: K, value: DraftValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setError(null);
  }

  function validate(): string | null {
    if (!values.sender.trim()) return "Enter the alert sender.";
    if (!values.event.trim()) return "Enter the alert event.";
    if (!values.headline.trim()) return "Enter the alert headline.";
    if (!values.description.trim()) return "Enter the alert description.";
    if (values.scope === "Private" && !values.addresses.trim()) return "Enter the private destination addresses.";
    return null;
  }

  function beginReview() {
    const issue = validate();
    if (issue) { setError(issue); return; }
    setReviewing(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const result = await props.client.createCapDraft(props.jurisdictionId, draftFrom(values), props.incidentId ?? undefined);
      setDirty(false);
      props.onSaved(result.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Local draft could not be saved");
    } finally {
      setSaving(false);
    }
  }

  const form = (
    <div className="alert-compose-form">
      <label>Record type<select value={values.kind} onChange={(event) => change("kind", event.target.value as DraftKind)}><option value="Draft">Local draft</option><option value="Exercise">Exercise</option><option value="Test">Test</option></select></label>
      <label>Sender<input value={values.sender} onChange={(event) => change("sender", event.target.value)} /></label>
      <label>Intended audience<select value={values.scope} onChange={(event) => change("scope", event.target.value as DraftValues["scope"])}>{CAP_SCOPE.map((scope) => <option key={scope}>{scope}</option>)}</select></label>
      {values.scope === "Private" ? <label>Private destination addresses<input value={values.addresses} onChange={(event) => change("addresses", event.target.value)} /></label> : null}
      <label>Category<select value={values.category} onChange={(event) => change("category", event.target.value as DraftValues["category"])}>{CAP_CATEGORY.map((category) => <option key={category}>{category}</option>)}</select></label>
      <label>Event<input value={values.event} onChange={(event) => change("event", event.target.value)} /></label>
      <label>Headline<input value={values.headline} onChange={(event) => change("headline", event.target.value)} /></label>
      <label>Description<textarea rows={5} value={values.description} onChange={(event) => change("description", event.target.value)} /></label>
      <label>Instruction<textarea rows={3} value={values.instruction} onChange={(event) => change("instruction", event.target.value)} /></label>
      <div className="alert-compose-classification">
        <label>Urgency<select value={values.urgency} onChange={(event) => change("urgency", event.target.value as DraftValues["urgency"])}>{CAP_URGENCY.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Severity<select value={values.severity} onChange={(event) => change("severity", event.target.value as DraftValues["severity"])}>{CAP_SEVERITY.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Certainty<select value={values.certainty} onChange={(event) => change("certainty", event.target.value as DraftValues["certainty"])}>{CAP_CERTAINTY.map((value) => <option key={value}>{value}</option>)}</select></label>
      </div>
    </div>
  );

  const preview = (
    <div className="alert-compose-preview">
      <span className="notification-state" data-state={values.kind === "Draft" ? "draft" : "exercise"}>{values.kind === "Draft" ? "Local draft" : values.kind}</span>
      <h3>{values.headline}</h3>
      <p>{values.description}</p>
      <dl className="notification-facts">
        <div><dt>Event</dt><dd>{values.event}</dd></div>
        <div><dt>Urgency</dt><dd>{values.urgency}</dd></div>
        <div><dt>Severity</dt><dd>{values.severity}</dd></div>
        <div><dt>Intended audience</dt><dd>{values.scope}{values.addresses ? ` · ${values.addresses}` : ""}</dd></div>
        <div><dt>Actual destination</dt><dd>Local workspace only</dd></div>
        <div><dt>External transmission</dt><dd>Not sent</dd></div>
      </dl>
      <p className="notification-boundary">Saving creates a local CAP record. External delivery requires a separately authorized action and is unavailable here.</p>
    </div>
  );

  return (
    <Drawer
      open={props.open}
      title={reviewing ? "Review local alert" : "Compose local alert"}
      unsaved={dirty}
      onDiscard={() => setDirty(false)}
      onClose={props.onClose}
      footer={<div className="notification-actions">
        {reviewing ? <>
          <ActionButton onClick={() => setReviewing(false)} disabled={saving}>Back to draft</ActionButton>
          <ActionButton kind="primary" loading={saving} loadingLabel="Saving local draft…" onClick={() => void save()}>Save local draft</ActionButton>
          <ActionButton disabled>External send unavailable</ActionButton>
        </> : <ActionButton kind="primary" onClick={beginReview}>Review local draft</ActionButton>}
      </div>}
    >
      {reviewing ? preview : form}
      {error ? <p role="alert" className="notification-error">{error}</p> : null}
    </Drawer>
  );
}

export function AlertsSurface({ client, jurisdictionId, incidentId, canAuthor, actorEmail }: AlertsSurfaceProps) {
  const notes = usePolled(() => client.notifications(), 8000, []);
  const alerts = useAsync(() => client.listCapAlerts(jurisdictionId), [jurisdictionId]);
  const [tab, setTab] = useState("inbox");
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>("all");
  const [alertFilter, setAlertFilter] = useState<AlertFilter>("all");
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [acknowledging, setAcknowledging] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [alertDetail, setAlertDetail] = useState<CapAlertDetail | null>(null);
  const [alertDetailLoading, setAlertDetailLoading] = useState(false);
  const [alertDetailError, setAlertDetailError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);

  useEffect(() => {
    setSelectedAlertId(null);
    setAlertDetail(null);
  }, [jurisdictionId]);

  useEffect(() => {
    let active = true;
    if (!selectedAlertId) { setAlertDetail(null); setAlertDetailError(null); return () => { active = false; }; }
    setAlertDetail(null);
    setAlertDetailLoading(true);
    setAlertDetailError(null);
    void client.getCapAlert(selectedAlertId).then((detail) => {
      if (active) setAlertDetail(detail);
    }).catch((error) => {
      if (active) setAlertDetailError(error instanceof Error ? error.message : "Alert detail unavailable");
    }).finally(() => { if (active) setAlertDetailLoading(false); });
    return () => { active = false; };
  }, [client, selectedAlertId]);

  const notificationItems = useMemo(() => (notes.data ?? []).map((item) => opened.has(item.id) && !item.read_at ? { ...item, read_at: new Date().toISOString() } : item), [notes.data, opened]);
  const filteredNotes = notificationItems.filter((item) => inboxFilter === "all"
    || (inboxFilter === "unread" && item.assigned_to_current_actor && !item.read_at)
    || (inboxFilter === "unacknowledged" && item.assigned_to_current_actor && !item.acknowledged_at)
    || (inboxFilter === "failed" && item.status === "failed"));
  const alertItems = alerts.data ?? [];
  const filteredAlerts = alertItems.filter((item) => alertFilter === "all"
    || (alertFilter === "received" && item.origin === "ingested")
    || (alertFilter === "exercise" && (item.status === "Exercise" || item.status === "Test"))
    || item.review?.state === alertFilter);
  const selectedNote = notificationItems.find((item) => item.id === selectedNoteId) ?? null;
  const selectedAlert = alertItems.find((item) => item.id === selectedAlertId) ?? null;

  async function openNotification(item: RawNotification) {
    setSelectedNoteId(item.id);
    setActionError(null);
    if (item.read_at || !item.assigned_to_current_actor) return;
    try {
      await client.markNotificationRead(item.id);
      setOpened((current) => new Set([...current, item.id]));
      notes.reload();
    }
    catch (error) { setActionError(error instanceof Error ? error.message : "Notification could not be marked read"); }
  }

  async function acknowledge() {
    if (!selectedNote) return;
    setAcknowledging(true);
    setActionError(null);
    try { await client.acknowledgeNotification(selectedNote.id); notes.reload(); }
    catch (error) { setActionError(error instanceof Error ? error.message : "Notification could not be acknowledged"); }
    finally { setAcknowledging(false); }
  }

  async function review(state: AlertReviewState) {
    if (!selectedAlertId) return;
    setReviewing(true);
    setAlertDetailError(null);
    try {
      const result = await client.reviewCapAlert(selectedAlertId, state);
      setAlertDetail((current) => current ? { ...current, review: result } : current);
      alerts.reload();
    } catch (error) {
      setAlertDetailError(error instanceof Error ? error.message : "Review state could not be changed");
    } finally { setReviewing(false); }
  }

  function selectAlert(id: string) {
    if (id === selectedAlertId) return;
    setAlertDetail(null);
    setAlertDetailError(null);
    setSelectedAlertId(id);
  }

  function saved(id: string) {
    setComposerOpen(false);
    setTab("alerts");
    selectAlert(id);
    alerts.reload();
  }

  useEffect(() => {
    setComposerOpen(false);
  }, [jurisdictionId, incidentId]);

  return (
    <div className="notification-workspace">
      <header className="notification-workspace-header">
        <div><span className="notification-eyebrow">Operational communications</span><h2>Alerts and notifications</h2><p>Reading, acknowledgement, review, and external transmission remain separate states.</p></div>
        {canAuthor ? <ActionButton kind="primary" onClick={() => setComposerOpen(true)}>Compose local alert</ActionButton> : null}
      </header>
      <Tabs id="notification-workspace" label="Alert workspace" value={tab} onChange={setTab} tabs={[{ id: "inbox", label: `Inbox (${notificationItems.length})` }, { id: "alerts", label: `Alert records (${alertItems.length})` }]} />
      {tab === "inbox" ? (
        <section id="notification-workspace-inbox-panel" role="tabpanel" aria-labelledby="notification-workspace-inbox-tab" className="notification-split">
          <div className="notification-list-pane">
            <label className="notification-filter">Show<select value={inboxFilter} onChange={(event: ChangeEvent<HTMLSelectElement>) => setInboxFilter(event.target.value as InboxFilter)}><option value="all">All notifications</option><option value="unread">Unread</option><option value="unacknowledged">Acknowledgement pending</option><option value="failed">Delivery failed</option></select></label>
            {notes.error ? <p role="status" className="notification-stale">Update failed. Showing the last received inbox.</p> : null}
            {notes.loading && !notes.data ? <Loading label="Loading notifications…" /> : filteredNotes.length === 0 ? <p className="notification-empty">No notifications match this filter.</p> : <ul className="notification-list">
              {filteredNotes.map((item) => <li key={item.id}><button type="button" aria-pressed={item.id === selectedNoteId} onClick={() => void openNotification(item)}><span className="notification-list-title"><strong>{item.title}</strong><span className="notification-state" data-state={notificationState(item).key}>{notificationState(item).label}</span></span><span>{item.incident_name ?? channelLabel(item.channel)} · {formatTime(item.created_at)}</span><small>{item.destination}</small></button></li>)}
            </ul>}
          </div>
          <NotificationDetail item={selectedNote} actionError={actionError} acknowledging={acknowledging} onAcknowledge={() => void acknowledge()} />
        </section>
      ) : (
        <section id="notification-workspace-alerts-panel" role="tabpanel" aria-labelledby="notification-workspace-alerts-tab" className="notification-split">
          <div className="notification-list-pane">
            <label className="notification-filter">Show<select value={alertFilter} onChange={(event: ChangeEvent<HTMLSelectElement>) => setAlertFilter(event.target.value as AlertFilter)}><option value="all">All alert records</option><option value="draft">Local drafts</option><option value="in_review">In review</option><option value="approved">Approved locally</option><option value="exercise">Exercises and tests</option><option value="received">Received external alerts</option></select></label>
            {alerts.error ? <p role="status" className="notification-stale">Update failed. Showing the last received alert records.</p> : null}
            {alerts.loading && !alerts.data ? <Loading label="Loading alert records…" /> : filteredAlerts.length === 0 ? <p className="notification-empty">No alert records match this filter.</p> : <ul className="notification-list alert-record-list">
              {filteredAlerts.map((item) => <li key={item.id}><button type="button" aria-pressed={item.id === selectedAlertId} onClick={() => selectAlert(item.id)}><span className="notification-list-title"><strong>{item.headline ?? item.event ?? item.identifier}</strong><span className="notification-state" data-state={item.status === "Exercise" || item.status === "Test" ? "exercise" : item.review?.state ?? "stored"}>{reviewLabel(item)}</span></span><span>{item.status} · {item.scope} · {formatTime(item.createdAt)}</span><small>{item.origin === "ingested" ? "Received externally · " : ""}Workspace outbound: {transmissionLabel(item.transmission)}</small></button></li>)}
            </ul>}
          </div>
          <AlertDetail summary={selectedAlert} detail={alertDetail} loading={alertDetailLoading} error={alertDetailError} canAuthor={canAuthor} reviewing={reviewing} onReview={(state) => void review(state)} />
        </section>
      )}
      <AlertComposer open={composerOpen} client={client} jurisdictionId={jurisdictionId} incidentId={incidentId} actorEmail={actorEmail} onClose={() => setComposerOpen(false)} onSaved={saved} />
    </div>
  );
}
