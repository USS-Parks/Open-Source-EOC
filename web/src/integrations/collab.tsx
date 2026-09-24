import { useState, type FormEvent } from "react";
import { ICS_SECTIONS } from "@openeoc/shared";
import { EnumSelect, Panel, StatusBadge, TextField } from "../design/components.js";
import { ActionButton } from "../design/controls.js";
import type { ApiClient, CollabBackendInput, CollabStatus } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import "../datasets/datasets.css";
import "./integrations.css";

/**
 * Collaboration channels, shown only where the collab integration runs: the
 * administrator's chat backend settings, and the incident's channel actions.
 * With no backend in use the server notifies the incident's position holders
 * in the app instead, and each action says so.
 */

export const SECTION_LABELS: Readonly<Record<string, string>> = {
  all: "Whole incident",
  command: "Command",
  operations: "Operations",
  planning: "Planning",
  logistics: "Logistics",
  finance_admin: "Finance and administration",
  intelligence_investigations: "Intelligence and investigations",
};
const BACKENDS: Readonly<Record<string, string>> = { mattermost: "Mattermost", matrix: "Matrix" };

/** Which action is running, one notice or error, and a runner that sets them. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const run = async (name: string, work: () => Promise<string>) => {
    setBusy(name); setError(null); setNotice("");
    try { setNotice(await work()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The request failed."); }
    finally { setBusy(null); }
  };
  const feedback = <>
    {error ? <p className="d21-error" role="alert">{error}</p> : null}
    {notice ? <p role="status" className="integrations-status">{notice}</p> : null}
  </>;
  return { busy, run, feedback };
}

function inUse(status: CollabStatus): boolean {
  return status.enabled && status.configured;
}

function backendLine(status: CollabStatus): string {
  return inUse(status)
    ? `Channels run on ${BACKENDS[status.kind ?? ""] ?? "the chat backend"} at ${status.baseUrl}.`
    : "No chat backend is in use. Channel actions notify the incident's position holders in the app instead.";
}

/** The jurisdiction's chat backend. The access token is stored encrypted and never shown. */
export function CollabSettings(props: { client: ApiClient; jurisdictionId: string }) {
  const status = useAsync(() => props.client.collabStatus(props.jurisdictionId), [props.jurisdictionId]);
  return (
    <Panel title="Collaboration channels">
      {status.error ? <p className="d21-error" role="alert">{status.error}</p> : null}
      {!status.data && !status.error ? <p className="d21-muted">Loading collaboration settings…</p> : null}
      {status.data ? <CollabForm {...props} status={status.data} onSaved={status.reload} /> : null}
    </Panel>
  );
}

function CollabForm(props: { client: ApiClient; jurisdictionId: string; status: CollabStatus; onSaved: () => void }) {
  const { status } = props;
  const [kind, setKind] = useState(status.kind === "matrix" ? "matrix" : "mattermost");
  const [baseUrl, setBaseUrl] = useState(status.baseUrl ?? "");
  const [homeserver, setHomeserver] = useState("");
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState(status.enabled);
  const { busy, run, feedback } = useAction();
  const save = (event: FormEvent) => {
    event.preventDefault();
    void run("save", async () => {
      if (!baseUrl.trim()) throw new Error("Enter the chat server address.");
      if (enabled && !status.configured && !token) throw new Error("Enter the access token the chat server issued for this platform.");
      const input: CollabBackendInput = {
        kind: kind as CollabBackendInput["kind"],
        baseUrl: baseUrl.trim(),
        enabled,
        ...(token ? { token } : {}),
        ...(kind === "matrix" && homeserver.trim() ? { homeserver: homeserver.trim() } : {}),
      };
      await props.client.configureCollab(props.jurisdictionId, input);
      // The token never stays in the page once the server holds it.
      setToken("");
      props.onSaved();
      return "Collaboration settings saved.";
    });
  };
  return (
    <form onSubmit={save}>
      <p className="d21-muted is-lead">
        <StatusBadge status={inUse(status) ? "success" : "unknown"}>{inUse(status) ? "In use" : "Not in use"}</StatusBadge>{" "}
        {backendLine(status)}
      </p>
      <fieldset disabled={busy !== null} className="d21-form-grid">
        <EnumSelect label="Chat backend" values={Object.keys(BACKENDS)} labels={BACKENDS} value={kind} onChange={setKind} />
        <TextField label="Chat server address" value={baseUrl} onChange={setBaseUrl} required />
        {kind === "matrix" ? <TextField label="Matrix homeserver domain" value={homeserver} onChange={setHomeserver} /> : null}
        <TextField label="Access token" type="password" value={token} onChange={setToken} />
        <p className="d21-muted d21-form-grid-wide">
          {status.configured
            ? "An access token is stored. It is never shown; leave the field blank to keep it."
            : "No access token is stored."}
        </p>
        <label className="d21-form-grid-wide eoc-inline">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Use this backend for incident channels
        </label>
        <div className="d21-form-grid-wide">
          <ActionButton kind="primary" type="submit" loading={busy === "save"} loadingLabel="Saving…">Save collaboration settings</ActionButton>
        </div>
      </fieldset>
      {feedback}
    </form>
  );
}

/** The incident's channels: set up, match membership to position holders, announce, archive. */
export function IncidentCollaboration(props: {
  client: ApiClient;
  jurisdictionId: string;
  incidentId: string;
  incidentName: string;
  canAdmin: boolean;
  canWrite: boolean;
  closed: boolean;
}) {
  const status = useAsync(() => props.client.collabStatus(props.jurisdictionId), [props.jurisdictionId]);
  const [section, setSection] = useState("all");
  const [text, setText] = useState("");
  const { busy, run, feedback } = useAction();
  const { client, incidentId } = props;
  const announce = (event: FormEvent) => {
    event.preventDefault();
    void run("announce", async () => {
      if (!text.trim()) throw new Error("Enter the announcement.");
      const result = await client.announceCollab(incidentId, { section, text: text.trim() });
      setText("");
      return result.degraded
        ? "No active channels, so the announcement went to the position holders in the app."
        : `Announcement posted to ${SECTION_LABELS[section]}.`;
    });
  };
  return (
    <Panel title={`${props.incidentName}: collaboration channels`}>
      <p className="d21-muted">
        {status.data ? backendLine(status.data) : status.error ?? "Checking the chat backend…"}{" "}
        There is one channel for the whole incident and one per ICS section, with members drawn from the position holders.
      </p>
      {props.canAdmin ? (
        <div className="d21-toolbar is-start">
          {props.closed ? null : <>
            <ActionButton kind="primary" loading={busy === "provision"} loadingLabel="Setting up…" disabled={busy !== null}
              onClick={() => void run("provision", async () => {
                const result = await client.provisionCollab(incidentId);
                return result.degraded
                  ? "No chat backend is in use, so the position holders were notified in the app."
                  : `${result.channels} channels are ready on ${BACKENDS[result.backend ?? ""] ?? "the chat backend"}.`;
              })}>Set up channels</ActionButton>
            <ActionButton loading={busy === "sync"} loadingLabel="Updating…" disabled={busy !== null}
              onClick={() => void run("sync", async () => {
                const result = await client.syncCollab(incidentId);
                return result.degraded
                  ? "There are no active channels to update. Set up channels first."
                  : `Membership matches the position holders: ${result.added} added, ${result.removed} removed.`;
              })}>Update membership</ActionButton>
          </>}
          <ActionButton kind="danger" loading={busy === "archive"} loadingLabel="Archiving…" disabled={busy !== null}
            onClick={() => void run("archive", async () => (await client.archiveCollab(incidentId)).archived
              ? "Channels archived."
              : "There were no active channels to archive.")}>Archive channels</ActionButton>
        </div>
      ) : null}
      {props.canWrite && !props.closed ? (
        <form onSubmit={announce} className="eoc-space-above">
          <fieldset disabled={busy !== null} className="d21-form-grid">
            <EnumSelect label="Channel" values={["all", ...ICS_SECTIONS.values]} labels={SECTION_LABELS} value={section} onChange={setSection} />
            <TextField label="Announcement" value={text} onChange={setText} required />
            <div className="d21-form-grid-wide">
              <ActionButton type="submit" loading={busy === "announce"} loadingLabel="Posting…">Post announcement</ActionButton>
            </div>
          </fieldset>
        </form>
      ) : null}
      {feedback}
    </Panel>
  );
}
