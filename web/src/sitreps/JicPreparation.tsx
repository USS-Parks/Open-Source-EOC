import { useEffect, useState } from "react";
import type { SitrepRow } from "@openeoc/shared";
import type { ApiClient } from "../app/api/client.js";
import { Button } from "../design/components.js";
import { Icon } from "../design/icons/index.js";
import { ErrorNote } from "../app/screens/parts.js";

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(`${incidentName} public information update`);
    setBody(draftBody(props.sitrep));
    setAgencies("");
    setReleaseId(null);
    setSavedDraft(null);
    setState("idle");
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
      <footer>
        <Icon decorative name="source" size={16} />
        FOUO source: SITREP revision {props.sitrep.revision ?? props.sitrep.content.revision ?? 1}
      </footer>
    </aside>
  );
}
