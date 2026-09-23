import { useEffect, useState } from "react";
import type { SitrepRow } from "@openeoc/shared";
import type { ApiClient } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { Button, StatusBadge, type Status } from "../design/components.js";
import { Icon } from "../design/icons/index.js";
import { ErrorNote } from "../app/screens/parts.js";

const RELEASE_STATUS: Readonly<Record<string, { readonly label: string; readonly tone: Status }>> = {
  pending: { label: "In review", tone: "warning" },
  approved: { label: "Approved", tone: "info" },
  rejected: { label: "Rejected", tone: "critical" },
  published: { label: "Published", tone: "success" },
};
const CHANNEL_LABELS: Readonly<Record<string, string>> = {
  public_feed: "public information feed",
  cap: "CAP alert",
  collab: "incident collaboration channels",
};
const INQUIRY_STATUS: Readonly<Record<LoggedInquiry["status"], { readonly label: string; readonly tone: Status }>> = {
  open: { label: "Logged", tone: "warning" },
  assigned: { label: "Assigned", tone: "info" },
  answered: { label: "Answered", tone: "success" },
};
/** How many public messages the panel lists; the feed route returns up to 100. */
const FEED_SHOWN = 10;

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/**
 * The submitted release's approval chain and publication. Each required
 * agency approves or rejects; the server settles the chain and only an
 * approved release can publish. A peer agency decides from its own instance.
 */
function ReleaseReview(props: {
  readonly client: ApiClient;
  readonly releaseId: string;
  readonly agencies: readonly string[];
  readonly onStatus: (status: string) => void;
  readonly onPublished: () => void;
}) {
  const [status, setStatus] = useState("pending");
  const [decided, setDecided] = useState<Readonly<Record<string, "approve" | "reject">>>({});
  const [note, setNote] = useState("");
  const [toPublicFeed, setToPublicFeed] = useState(true);
  const [toCollab, setToCollab] = useState(false);
  const [channels, setChannels] = useState<readonly string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setStatus(next);
      props.onStatus(next);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };
  const decide = (agency: string, decision: "approve" | "reject") => run(async () => {
    const result = await props.client.decideJicRelease(props.releaseId, {
      agency,
      decision,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setDecided((current) => ({ ...current, [agency]: decision }));
    setNote("");
    return result.status;
  });
  const publish = () => run(async () => {
    const result = await props.client.publishJicRelease(props.releaseId, { toPublicFeed, toCollab });
    setChannels(result.channels);
    props.onPublished();
    return result.status;
  });
  const shown = RELEASE_STATUS[status] ?? { label: status, tone: "unknown" as const };

  return (
    <section className="eoc-jic-section" aria-label="Review and publication">
      <h3>Review and publication</h3>
      <p className="eoc-jic-status">Review status <StatusBadge status={shown.tone}>{shown.label}</StatusBadge></p>
      {props.agencies.length === 0 ? (
        <p className="eoc-jic-guidance">
          No reviewing agency is named, so this release cannot be approved. Save a new draft that names at least one agency.
        </p>
      ) : status === "pending" ? (
        <>
          <p className="eoc-jic-guidance">
            Record the decision for your own agency. An agency registered as a federation peer decides from its own instance.
          </p>
          <label>
            Decision note
            <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
          </label>
          <ul className="eoc-jic-list">
            {props.agencies.map((agency) => (
              <li key={agency}>
                <strong>{agency}</strong>
                {decided[agency] ? (
                  <span>{decided[agency] === "approve" ? "Approved" : "Rejected"} by you</span>
                ) : (
                  <span className="eoc-jic-actions">
                    <Button onClick={() => void decide(agency, "approve")} disabled={busy}>Approve for {agency}</Button>
                    <Button kind="danger" onClick={() => void decide(agency, "reject")} disabled={busy}>Reject for {agency}</Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {status === "rejected" ? (
        <p className="eoc-jic-guidance">A rejected release cannot publish. Revise the statement and save a new draft.</p>
      ) : null}
      {status === "approved" ? (
        <>
          <label className="eoc-jic-check">
            <input type="checkbox" checked={toPublicFeed} onChange={(event) => setToPublicFeed(event.target.checked)} />
            Post to the public information feed
          </label>
          <label className="eoc-jic-check">
            <input type="checkbox" checked={toCollab} onChange={(event) => setToCollab(event.target.checked)} />
            Announce to incident collaboration channels
          </label>
          <div className="eoc-jic-actions">
            <Button kind="primary" onClick={() => void publish()} disabled={busy || (!toPublicFeed && !toCollab)}>
              {busy ? "Publishing…" : "Publish release"}
            </Button>
          </div>
        </>
      ) : null}
      {channels ? (
        <p className="eoc-jic-state" role="status">
          {channels.length
            ? `Published to the ${channels.map((channel) => CHANNEL_LABELS[channel] ?? channel).join(" and ")}`
            : "Published; no outlet accepted it"}
        </p>
      ) : null}
      {error ? <ErrorNote message={error} /> : null}
    </section>
  );
}

interface LoggedInquiry {
  readonly id: string;
  readonly outlet: string;
  readonly subject: string;
  readonly status: "open" | "assigned" | "answered";
  readonly position?: string;
}

/**
 * Media inquiries for the incident: log, assign to a position, answer with
 * approved release language. The server keeps every inquiry; this list holds
 * the ones logged in this view.
 */
function MediaInquiries(props: {
  readonly client: ApiClient;
  readonly jurisdictionId: string;
  readonly incidentId: string;
  readonly answerReleaseId: string | null;
}) {
  const positions = useAsync(() => props.client.listPositions(props.jurisdictionId), [props.jurisdictionId]);
  const [outlet, setOutlet] = useState("");
  const [subject, setSubject] = useState("");
  const [question, setQuestion] = useState("");
  const [inquiries, setInquiries] = useState<readonly LoggedInquiry[]>([]);
  const [targets, setTargets] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };
  const update = (id: string, patch: Partial<LoggedInquiry>) =>
    setInquiries((current) => current.map((inquiry) => (inquiry.id === id ? { ...inquiry, ...patch } : inquiry)));
  const log = () => run(async () => {
    const entry = { outlet: outlet.trim(), subject: subject.trim(), question: question.trim() };
    if (!entry.outlet || !entry.subject || !entry.question) throw new Error("Enter the outlet, subject and question.");
    const result = await props.client.logJicInquiry(props.jurisdictionId, { ...entry, incidentId: props.incidentId });
    setInquiries((current) => [{ id: result.id, outlet: entry.outlet, subject: entry.subject, status: "open" }, ...current]);
    setOutlet("");
    setSubject("");
    setQuestion("");
  });
  const assign = (inquiry: LoggedInquiry) => run(async () => {
    const positionId = targets[inquiry.id];
    if (!positionId) return;
    await props.client.assignJicInquiry(inquiry.id, positionId);
    const title = positions.data?.find((position) => position.id === positionId)?.title;
    update(inquiry.id, { status: "assigned", ...(title ? { position: title } : {}) });
  });
  const answer = (inquiry: LoggedInquiry) => run(async () => {
    if (!props.answerReleaseId) return;
    await props.client.answerJicInquiry(inquiry.id, props.answerReleaseId);
    update(inquiry.id, { status: "answered" });
  });

  return (
    <section className="eoc-jic-section" aria-label="Media inquiries">
      <h3>Media inquiries</h3>
      <p className="eoc-jic-guidance">
        An answer cites this panel&apos;s release once it is approved or published. The server keeps every inquiry; this list shows the ones logged here.
      </p>
      <form onSubmit={(event) => { event.preventDefault(); void log(); }}>
        <label>
          Media outlet
          <input value={outlet} onChange={(event) => setOutlet(event.target.value)} maxLength={200} required />
        </label>
        <label>
          Inquiry subject
          <input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={240} required />
        </label>
        <label>
          Question
          <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} required />
        </label>
        <div className="eoc-jic-actions">
          <Button type="submit" disabled={busy}>Log inquiry</Button>
        </div>
      </form>
      {inquiries.length ? (
        <ul className="eoc-jic-list">
          {inquiries.map((inquiry) => {
            const shown = INQUIRY_STATUS[inquiry.status];
            return (
              <li key={inquiry.id}>
                <span><strong>{inquiry.outlet}</strong> · {inquiry.subject}</span>
                <span><StatusBadge status={shown.tone}>{shown.label}</StatusBadge>{inquiry.position ? ` · ${inquiry.position}` : ""}</span>
                {inquiry.status === "answered" ? null : (
                  <>
                    <label>
                      Assign to position
                      <select
                        aria-label={`Assign to position: ${inquiry.subject}`}
                        value={targets[inquiry.id] ?? ""}
                        onChange={(event) => setTargets((current) => ({ ...current, [inquiry.id]: event.target.value }))}
                      >
                        <option value="">Choose a position</option>
                        {(positions.data ?? []).map((position) => <option key={position.id} value={position.id}>{position.title}</option>)}
                      </select>
                    </label>
                    <span className="eoc-jic-actions">
                      <Button onClick={() => void assign(inquiry)} disabled={busy || !targets[inquiry.id]}>Assign</Button>
                      <Button onClick={() => void answer(inquiry)} disabled={busy || !props.answerReleaseId}>Answer with approved release</Button>
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {positions.error ? <ErrorNote message={positions.error} /> : null}
      {error ? <ErrorNote message={error} /> : null}
    </section>
  );
}

function draftBody(sitrep: SitrepRow): string {
  const points = sitrep.content.talkingPoints ?? [];
  const responses = sitrep.content.rumorControl
    .filter((item) => item.response && (item.status === "false" || item.status === "addressed"))
    .map((item) => item.response!);
  return [
    ...points.map((item) => item.point),
    ...responses,
  ].join("\n\n");
}

export function JicPreparation(props: {
  readonly client: ApiClient;
  readonly jurisdictionId: string;
  readonly sitrep: SitrepRow;
}) {
  const incidentId = props.sitrep.content.incident?.id ?? props.sitrep.incidentId ?? null;
  const incidentName = props.sitrep.content.incident?.name ?? props.sitrep.incidentName ?? "Incident";
  const [title, setTitle] = useState(`${incidentName} public information update`);
  const [body, setBody] = useState(() => draftBody(props.sitrep));
  const [agencies, setAgencies] = useState("");
  const [releaseId, setReleaseId] = useState<string | null>(null);
  const [savedDraft, setSavedDraft] = useState<{
    readonly title: string;
    readonly body: string;
    readonly agencies: readonly string[];
  } | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "draft" | "submitting" | "submitted">("idle");
  const [releaseStatus, setReleaseStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const feed = useAsync(() => props.client.listJicPublicFeed(props.jurisdictionId), [props.jurisdictionId]);

  useEffect(() => {
    setTitle(`${incidentName} public information update`);
    setBody(draftBody(props.sitrep));
    setAgencies("");
    setReleaseId(null);
    setSavedDraft(null);
    setState("idle");
    setReleaseStatus(null);
    setError(null);
  }, [props.sitrep.id, incidentName]);

  const save = async () => {
    if (!incidentId || !title.trim() || !body.trim()) return;
    const draft = {
      title: title.trim(),
      body: body.trim(),
      agencies: agencies.split(",").map((value) => value.trim()).filter(Boolean),
    };
    setState("saving");
    setError(null);
    try {
      const result = await props.client.draftJicRelease(props.jurisdictionId, {
        incidentId,
        title: draft.title,
        body: draft.body,
        requiredAgencies: draft.agencies,
      });
      setReleaseId(result.id);
      setSavedDraft(draft);
      setState("draft");
      setReleaseStatus(null);
    } catch (caught) {
      setState("idle");
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const currentAgencies = agencies.split(",").map((value) => value.trim()).filter(Boolean);
  const hasUnsavedChanges = savedDraft !== null && (
    title.trim() !== savedDraft.title
    || body.trim() !== savedDraft.body
    || currentAgencies.join("\u0000") !== savedDraft.agencies.join("\u0000")
  );

  const submit = async () => {
    if (!releaseId || !savedDraft || hasUnsavedChanges) return;
    setState("submitting");
    setError(null);
    try {
      await props.client.submitJicRelease(releaseId);
      setState("submitted");
      setReleaseStatus("pending");
    } catch (caught) {
      setState("draft");
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <aside className="eoc-jic-preparation" aria-labelledby="jic-preparation-title">
      <header>
        <span aria-hidden="true"><Icon decorative name="jic" size={24} /></span>
        <div>
          <span className="eoc-sitrep-eyebrow">Controlled preparation</span>
          <h2 id="jic-preparation-title">JIC draft</h2>
        </div>
      </header>
      <p className="eoc-jic-guidance">
        Start from approved talking points and confirmed rumor responses in this frozen revision.
        Saving or submitting for review does not publish.
      </p>
      {!incidentId ? (
        <p className="eoc-sitrep-callout">Legacy jurisdiction-wide SITREPs cannot create an incident-bound JIC draft.</p>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label>
            Release title
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} required />
          </label>
          <label>
            Draft statement
            <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={10} required />
          </label>
          <label>
            Required reviewing agencies
            <input
              value={agencies}
              onChange={(event) => setAgencies(event.target.value)}
              placeholder="County PIO, Public Health"
            />
          </label>
          {error ? <ErrorNote message={error} /> : null}
          {releaseId ? (
            <p className="eoc-jic-state" role="status">
              Draft {releaseId.slice(0, 8)} · {state === "submitted"
                ? "submitted for review"
                : hasUnsavedChanges ? "saved, not published · unsaved edits" : "saved, not published"}
            </p>
          ) : null}
          <div className="eoc-jic-actions">
            <Button kind="primary" type="submit" disabled={state === "saving" || state === "submitting" || state === "submitted"}>
              {state === "saving" ? "Saving…" : releaseId ? "Save as new draft" : "Save JIC draft"}
            </Button>
            <Button onClick={() => void submit()} disabled={!releaseId || hasUnsavedChanges
              || state === "saving" || state === "submitting" || state === "submitted"}>
              {state === "submitting" ? "Submitting…" : state === "submitted" ? "Submitted for review" : "Submit for review"}
            </Button>
          </div>
        </form>
      )}
      {incidentId && releaseId && savedDraft && state === "submitted" ? (
        <ReleaseReview
          key={releaseId}
          client={props.client}
          releaseId={releaseId}
          agencies={savedDraft.agencies}
          onStatus={setReleaseStatus}
          onPublished={feed.reload}
        />
      ) : null}
      <section className="eoc-jic-section" aria-label="Public information feed">
        <h3>Public information feed</h3>
        {feed.error ? <ErrorNote message={feed.error} /> : null}
        {feed.data && feed.data.length === 0 ? <p className="eoc-jic-guidance">Nothing is published yet.</p> : null}
        {feed.data && feed.data.length ? (
          <ol className="eoc-jic-list">
            {feed.data.slice(0, FEED_SHOWN).map((message) => (
              <li key={message.id}>
                <strong>{message.title}</strong>
                <small>Published {new Date(message.publishedAt).toLocaleString()}</small>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
      {incidentId ? (
        <MediaInquiries
          key={incidentId}
          client={props.client}
          jurisdictionId={props.jurisdictionId}
          incidentId={incidentId}
          answerReleaseId={releaseId && (releaseStatus === "approved" || releaseStatus === "published") ? releaseId : null}
        />
      ) : null}
      <footer>
        <Icon decorative name="source" size={16} />
        FOUO source: SITREP revision {props.sitrep.revision ?? props.sitrep.content.revision ?? 1}
      </footer>
    </aside>
  );
}
