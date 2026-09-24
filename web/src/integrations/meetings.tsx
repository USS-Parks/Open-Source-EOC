import { useState, type FormEvent } from "react";
import { ICS_SECTIONS } from "@openeoc/shared";
import { EnumSelect, Panel, StatusBadge, TextField } from "../design/components.js";
import { ActionButton } from "../design/controls.js";
import { BoardTable } from "../design/layout.js";
import type { ApiClient, MeetingConfig } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { SECTION_LABELS, useAction } from "./collab.js";
import "../datasets/datasets.css";
import "./integrations.css";

/**
 * Meetings and briefings, shown only where the meetings integration runs:
 * the administrator's Jitsi bridge settings, and for an incident its bridges
 * and scheduled briefings. The server notifies the incident's position
 * holders when a briefing falls due.
 */

const BRIDGE_LABELS: Readonly<Record<string, string>> = { ...SECTION_LABELS, incident: "Whole incident" };
const bridgeLabel = (section: string | null): string => BRIDGE_LABELS[section ?? "incident"] ?? section ?? "Whole incident";

/** The jurisdiction's Jitsi bridge. The token secret is stored encrypted and never shown. */
export function MeetingSettings(props: { client: ApiClient; jurisdictionId: string }) {
  const config = useAsync(() => props.client.meetingConfig(props.jurisdictionId), [props.jurisdictionId]);
  return (
    <Panel title="Meeting bridge">
      {config.error ? <p className="d21-error" role="alert">{config.error}</p> : null}
      {!config.data && !config.error ? <p className="d21-muted">Loading meeting settings…</p> : null}
      {config.data ? <MeetingForm {...props} config={config.data} onSaved={config.reload} /> : null}
    </Panel>
  );
}

function MeetingForm(props: { client: ApiClient; jurisdictionId: string; config: MeetingConfig; onSaved: () => void }) {
  const { config } = props;
  const [baseUrl, setBaseUrl] = useState(config.baseUrl ?? "");
  const [appId, setAppId] = useState(config.appId ?? "");
  const [secret, setSecret] = useState("");
  const [enabled, setEnabled] = useState(config.enabled);
  const { busy, run, feedback } = useAction();
  const inUse = config.configured && config.enabled;
  const save = (event: FormEvent) => {
    event.preventDefault();
    void run("save", async () => {
      if (!baseUrl.trim()) throw new Error("Enter the Jitsi server address.");
      if (secret && !appId.trim()) throw new Error("Enter the app id that goes with the token secret.");
      await props.client.configureMeetings(props.jurisdictionId, {
        baseUrl: baseUrl.trim(),
        enabled,
        ...(appId.trim() ? { appId: appId.trim() } : {}),
        ...(secret ? { secret } : {}),
      });
      // The secret never stays in the page once the server holds it.
      setSecret("");
      props.onSaved();
      return "Meeting settings saved.";
    });
  };
  return (
    <form onSubmit={save}>
      <p className="d21-muted is-lead">
        <StatusBadge status={inUse ? "success" : "unknown"}>{inUse ? "In use" : "Not in use"}</StatusBadge>{" "}
        {inUse ? `Incident bridges open on ${config.baseUrl}.` : "Incidents cannot open a bridge until a server is saved and in use."}
      </p>
      <fieldset disabled={busy !== null} className="d21-form-grid">
        <TextField label="Jitsi server address" value={baseUrl} onChange={setBaseUrl} required />
        <TextField label="App id" value={appId} onChange={setAppId} />
        <TextField label="Token secret" type="password" value={secret} onChange={setSecret} />
        <p className="d21-muted d21-form-grid-wide">
          {config.authenticated
            ? "A token secret is stored. It is never shown; leave the field blank to keep it. Each join link carries a signed token for that person, and administrators join as moderators."
            : "No token secret is stored, so join links are plain room links. Add an app id and secret to sign them."}
        </p>
        <label className="d21-form-grid-wide eoc-inline">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Offer meeting bridges for incidents
        </label>
        <div className="d21-form-grid-wide">
          <ActionButton kind="primary" type="submit" loading={busy === "save"} loadingLabel="Saving…">Save meeting settings</ActionButton>
        </div>
      </fieldset>
      {feedback}
    </form>
  );
}

/** The incident's meeting bridges and briefings. */
export function IncidentMeetings(props: {
  client: ApiClient;
  incidentId: string;
  incidentName: string;
  canWrite: boolean;
  closed: boolean;
}) {
  const { client, incidentId } = props;
  const bridges = useAsync(() => client.listMeetingBridges(incidentId), [incidentId]);
  const briefings = useAsync(() => client.listBriefings(incidentId), [incidentId]);
  const [bridgeSection, setBridgeSection] = useState("incident");
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [briefingSection, setBriefingSection] = useState("incident");
  const { busy, run, feedback } = useAction();
  const sections = ["incident", ...ICS_SECTIONS.values];
  const writable = props.canWrite && !props.closed;

  const schedule = (event: FormEvent) => {
    event.preventDefault();
    void run("schedule", async () => {
      const at = new Date(when);
      if (!title.trim() || Number.isNaN(at.getTime())) throw new Error("Enter the briefing title and when it starts.");
      await client.scheduleBriefing(incidentId, {
        title: title.trim(),
        scheduledAt: at.toISOString(),
        ...(briefingSection === "incident" ? {} : { section: briefingSection }),
      });
      setTitle(""); setWhen("");
      briefings.reload();
      return `${title.trim()} scheduled. The position holders are notified when it is due.`;
    });
  };

  return (
    <Panel title={`${props.incidentName}: meetings and briefings`}>
      <h3 className="integrations-heading">Bridges</h3>
      {bridges.error ? <p className="d21-error" role="alert">{bridges.error}</p> : null}
      {bridges.data?.length === 0 ? <p className="d21-muted">No bridge is open for this incident.</p> : null}
      {bridges.data?.length ? (
        <ul aria-label="Open bridges" className="integrations-bridges">
          {bridges.data.map((bridge) => (
            <li key={bridge.room}>
              {bridge.url
                ? <a href={bridge.url} target="_blank" rel="noopener noreferrer" className="integrations-join">Join the {bridgeLabel(bridge.section).toLowerCase()} bridge</a>
                : `${bridgeLabel(bridge.section)}: the meeting server is not set up.`}
            </li>
          ))}
        </ul>
      ) : null}
      {writable ? (
        <div className="d21-form-grid integrations-open">
          <EnumSelect label="Bridge for" values={sections} labels={BRIDGE_LABELS} value={bridgeSection} onChange={setBridgeSection} />
          <div>
            <ActionButton kind="primary" loading={busy === "bridge"} loadingLabel="Opening…" disabled={busy !== null}
              onClick={() => void run("bridge", async () => {
                const bridge = await client.openMeetingBridge(incidentId, bridgeSection === "incident" ? undefined : bridgeSection);
                bridges.reload();
                return `The ${bridgeLabel(bridge.section).toLowerCase()} bridge is open.`;
              })}>Open bridge</ActionButton>
          </div>
        </div>
      ) : null}

      <h3 className="integrations-heading is-later">Briefings</h3>
      {briefings.error ? <p className="d21-error" role="alert">{briefings.error}</p> : null}
      {briefings.data?.length === 0 ? <p className="d21-muted">No briefing is scheduled.</p> : null}
      {briefings.data?.length ? (
        <div className="integrations-scroll">
          <BoardTable caption="Scheduled briefings" columns={["Briefing", "For", "Starts", "Holders notified"]}
            rows={briefings.data.map((briefing) => [
              briefing.title, bridgeLabel(briefing.section), new Date(briefing.scheduledAt).toLocaleString(),
              briefing.notifiedAt ? new Date(briefing.notifiedAt).toLocaleString() : "Not yet",
            ])} />
        </div>
      ) : null}
      {writable ? (
        <form onSubmit={schedule} className="eoc-space-above">
          <fieldset disabled={busy !== null} className="d21-form-grid">
            <TextField label="Briefing title" value={title} onChange={setTitle} required />
            <p className="integrations-field">
              <label htmlFor={`briefing-when-${incidentId}`}>Starts</label>
              <input id={`briefing-when-${incidentId}`} type="datetime-local" required value={when}
                onChange={(event) => setWhen(event.target.value)} />
            </p>
            <EnumSelect label="Briefing for" values={sections} labels={BRIDGE_LABELS} value={briefingSection} onChange={setBriefingSection} />
            <div className="d21-form-grid-wide">
              <ActionButton type="submit" loading={busy === "schedule"} loadingLabel="Scheduling…">Schedule briefing</ActionButton>
            </div>
          </fieldset>
        </form>
      ) : null}
      {feedback}
    </Panel>
  );
}
