import { useState } from "react";
import { dictionaryValues } from "@openeoc/shared";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../../design/components.js";
import type { ApiClient, ReunificationAnswer } from "../api/client.js";
import { Scroll, SurfaceHeader } from "../screens/parts.js";

const KINDS = dictionaryValues("tracking.kinds") ?? ["patient"];
const CUSTODY = dictionaryValues("tracking.custody_states") ?? ["registered"];

/**
 * Object tracking and reunification (F, VEOC-25). Register a patient, evacuee,
 * animal, or asset with a tag; record custody scans as it moves through
 * stations; and search the custody chain to reunify. The restricted PII stays
 * server-side; this screen works the public-safe fields.
 */
export function TrackingSurface(props: { client: ApiClient; jurisdictionId: string }) {
  const [kind, setKind] = useState<string>(KINDS[0] ?? "patient");
  const [label, setLabel] = useState("");
  const [tag, setTag] = useState("");
  const [scanTag, setScanTag] = useState("");
  const [custodyState, setCustodyState] = useState<string>(CUSTODY[0] ?? "registered");
  const [station, setStation] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReunificationAnswer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const register = () =>
    run(async () => {
      if (!label.trim()) throw new Error("Enter a label.");
      const r = await props.client.registerTrackedObject(props.jurisdictionId, {
        kind,
        label: label.trim(),
        ...(tag.trim() ? { tag: tag.trim() } : {}),
      });
      setMsg(`Registered "${label.trim()}" as tag ${r.tag}.`);
      setScanTag(r.tag);
      setLabel("");
      setTag("");
    });

  const scan = () =>
    run(async () => {
      if (!scanTag.trim()) throw new Error("Enter the tag to scan.");
      await props.client.scanTrackedObject(props.jurisdictionId, {
        tag: scanTag.trim(),
        custodyState,
        ...(station.trim() ? { station: station.trim() } : {}),
      });
      setMsg(`Scan recorded for ${scanTag.trim()}: ${custodyState}.`);
    });

  const search = () =>
    run(async () => {
      const q = query.trim();
      setResults(await props.client.reunify(props.jurisdictionId, q.startsWith("#") ? { tag: q.slice(1) } : { label: q }));
    });

  return (
    <Scroll>
      <SurfaceHeader title="Tracking & Reunification" />
      <div style={{ display: "grid", gap: 16, maxWidth: 820 }}>
        <Panel title="Register a tracked object">
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 2fr 1fr" }}>
            <EnumSelect
              label="Kind"
              values={KINDS as string[]}
              value={kind}
              onChange={setKind}
            />
            <TextField label="Label" value={label} onChange={setLabel} />
            <TextField label="Tag (blank to auto-issue)" value={tag} onChange={setTag} />
          </div>
          <div style={{ marginTop: 12 }}>
            <Button kind="primary" onClick={register} disabled={busy}>
              Register
            </Button>
          </div>
        </Panel>

        <Panel title="Record a custody scan">
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
            <TextField label="Tag" value={scanTag} onChange={setScanTag} />
            <EnumSelect
              label="Custody state"
              values={CUSTODY as string[]}
              value={custodyState}
              onChange={setCustodyState}
            />
            <TextField label="Station" value={station} onChange={setStation} />
          </div>
          <div style={{ marginTop: 12 }}>
            <Button onClick={scan} disabled={busy}>
              Record scan
            </Button>
          </div>
        </Panel>

        <Panel title="Reunification search">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
            style={{ display: "flex", gap: 8, alignItems: "flex-end" }}
          >
            <div style={{ flex: 1 }}>
              <TextField label="Name, or #tag" value={query} onChange={setQuery} />
            </div>
            <Button type="submit" disabled={busy}>
              Search
            </Button>
          </form>
          {results ? (
            results.length === 0 ? (
              <p style={{ color: "var(--eoc-text-muted)", margin: "12px 0 0" }}>No matches.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 6 }}>
                {results.map((r) => (
                  <li
                    key={r.tag}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 10px",
                      border: "1px solid var(--eoc-border)",
                      borderRadius: 4,
                    }}
                  >
                    <StatusBadge status={r.latest.custodyState === "reunified" ? "success" : "info"}>
                      {r.latest.custodyState}
                    </StatusBadge>
                    <span style={{ flex: 1 }}>
                      <strong>{r.label}</strong>{" "}
                      <span style={{ color: "var(--eoc-text-muted)" }}>
                        {r.kind} · #{r.tag}
                      </span>
                    </span>
                    <span style={{ color: "var(--eoc-text-muted)", fontSize: "0.85em" }}>
                      {r.latest.station ?? r.latest.location ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </Panel>

        {msg ? <p style={{ color: "var(--eoc-status-success)", margin: 0 }}>{msg}</p> : null}
        {error ? (
          <p role="alert" style={{ color: "var(--eoc-status-critical)", margin: 0 }}>
            {error}
          </p>
        ) : null}
      </div>
    </Scroll>
  );
}
