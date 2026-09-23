import { useState } from "react";
import { COMMUNITY_LIFELINES, LIFELINE_STATUS } from "@openeoc/shared";
import { Button, EnumSelect, Panel, StatusBadge, TextField, type Status } from "../../design/components.js";
import type { LifelineKey } from "../../design/icons/index.js";
import type { ApiClient } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { ErrorNote, Loading } from "../screens/parts.js";
import { LIFELINE_LABELS } from "./lifeline-view.js";
import "../../datasets/datasets.css";

const TONE: Readonly<Record<string, Status>> = { stable: "success", stabilizing: "warning", unstable: "critical", unknown: "unknown" };
const STATUS_LABELS = Object.fromEntries(LIFELINE_STATUS.values.map((s) => [s, s[0]!.toUpperCase() + s.slice(1)]));
const lifelineLabel = (key: string) => LIFELINE_LABELS[key as LifelineKey] ?? key;

/**
 * The jurisdiction's standing lifeline status, kept outside any incident on
 * its lifelines board. A situation report composed without an incident reads
 * it. Admins and members record a status; the newest entry per lifeline wins.
 */
export function JurisdictionLifelines(props: { client: ApiClient; jurisdictionId: string; canWrite: boolean }) {
  const current = useAsync(() => props.client.jurisdictionLifelines(props.jurisdictionId), [props.jurisdictionId]);
  const [lifeline, setLifeline] = useState<string>(COMMUNITY_LIFELINES.values[0]!);
  const [status, setStatus] = useState<string>("stable");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const record = async () => {
    setBusy(true); setError(null); setNotice("");
    try {
      await props.client.setJurisdictionLifeline(props.jurisdictionId, { lifeline, status, ...(note.trim() ? { note: note.trim() } : {}) });
      setNote("");
      setNotice(`${lifelineLabel(lifeline)} recorded as ${STATUS_LABELS[status]!.toLowerCase()}.`);
      current.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The status could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Standing lifeline status">
      <p className="d21-muted">The jurisdiction's lifeline status outside any incident. A situation report composed without an incident uses it; incident assessments stay with their incident.</p>
      {current.error ? <ErrorNote message={current.error} /> : null}
      {!current.data && !current.error ? <Loading label="Loading standing lifeline status…" /> : null}
      {current.data ? <ul className="d21-readiness-list" aria-label="Standing lifeline status">
        {current.data.map((row) => (
          <li key={row.lifeline} className="d21-readiness-row" aria-label={lifelineLabel(row.lifeline)}>
            <div className="d21-readiness-title"><div><strong>{lifelineLabel(row.lifeline)}</strong>
              <span>{row.at ? `Recorded ${new Date(row.at).toLocaleString()}` : "Never recorded"}</span></div></div>
            <span style={{ alignSelf: "start" }}><StatusBadge status={TONE[row.status] ?? "unknown"}>{STATUS_LABELS[row.status] ?? row.status}</StatusBadge></span>
            {row.note ? <p className="d21-muted" style={{ margin: 0 }}>{row.note}</p> : null}
          </li>
        ))}
      </ul> : null}
      {props.canWrite ? <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: "12px 0 0", display: "grid", gap: 12 }}>
        <div className="d21-form-grid">
          <EnumSelect label="Lifeline" values={COMMUNITY_LIFELINES.values} value={lifeline} onChange={setLifeline}
            labels={Object.fromEntries(COMMUNITY_LIFELINES.values.map((key) => [key, lifelineLabel(key)]))} />
          <EnumSelect label="Standing status" values={LIFELINE_STATUS.values} value={status} onChange={setStatus} labels={STATUS_LABELS} />
          <div className="d21-form-grid-wide"><TextField label="Status note" value={note} onChange={setNote} /></div>
        </div>
        {error ? <p className="d21-error" role="alert">{error}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
        <div className="d21-toolbar">
          <span className="d21-muted">Each entry is kept on the jurisdiction's lifelines board.</span>
          <Button kind="primary" onClick={() => void record()}>Record status</Button>
        </div>
      </fieldset> : null}
    </Panel>
  );
}
