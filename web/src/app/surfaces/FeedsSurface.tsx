import { useState } from "react";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../../design/components.js";
import type { ApiClient } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { ErrorNote, Loading, Scroll, SurfaceHeader } from "../screens/parts.js";

const KINDS = ["geojson", "cap", "georss", "cot"];
type FeedKind = "cap" | "geojson" | "georss" | "cot";

/**
 * Live feeds administration (F18, interop). Register a polled upstream (CAP,
 * GeoJSON, GeoRSS, CoT) by URL, or a push feed that ingests over a one-time
 * token; see each feed's freshness and force a poll. Feeds render on the COP.
 */
export function FeedsSurface(props: { client: ApiClient; jurisdictionId: string; isAdmin: boolean }) {
  const [reload, setReload] = useState(0);
  const feeds = useAsync(
    () => props.client.listFeeds(props.jurisdictionId),
    [props.jurisdictionId, reload],
  );
  const [name, setName] = useState("");
  const [kind, setKind] = useState<FeedKind>("geojson");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      if (!name.trim()) throw new Error("Enter a feed name.");
      const push = url.trim().length === 0;
      const r = await props.client.createFeed(props.jurisdictionId, {
        name: name.trim(),
        kind,
        push,
        ...(url.trim() ? { url: url.trim() } : {}),
      });
      setName("");
      setUrl("");
      setToken(r.ingestToken ?? null);
    });

  const list = feeds.data ?? [];

  return (
    <Scroll>
      <SurfaceHeader title="Live Feeds" />
      <div style={{ display: "grid", gap: 16, maxWidth: 820 }}>
        {props.isAdmin ? (
        <Panel title="Add a feed">
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr" }}>
            <TextField label="Name" value={name} onChange={setName} />
            <EnumSelect
              label="Kind"
              values={KINDS}
              value={kind}
              onChange={(v) => setKind(v as FeedKind)}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <TextField label="Source URL (leave blank for a push feed)" value={url} onChange={setUrl} />
          </div>
          <div style={{ marginTop: 12 }}>
            <Button kind="primary" onClick={create} disabled={busy}>
              Add feed
            </Button>
          </div>
          {token ? (
            <p style={{ color: "var(--eoc-status-success)", margin: "8px 0 0" }}>
              Push ingest token (shown once): <code>{token}</code>
            </p>
          ) : null}
        </Panel>
        ) : null}

        <Panel title="Feeds">
          {feeds.loading && !feeds.data ? <Loading label="Loading feeds…" /> : null}
          {feeds.error && !feeds.data ? <ErrorNote message={feeds.error} /> : null}
          {feeds.data && list.length === 0 ? (
            <p style={{ color: "var(--eoc-text-muted)", margin: 0 }}>No feeds yet.</p>
          ) : null}
          {list.length > 0 ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
              {list.map((f) => (
                <li
                  key={f.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    border: "1px solid var(--eoc-border)",
                    borderRadius: 4,
                  }}
                >
                  <StatusBadge status={f.stale ? "warning" : f.enabled ? "success" : "unknown"}>
                    {f.stale ? "stale" : f.enabled ? "live" : "off"}
                  </StatusBadge>
                  <span style={{ flex: 1 }}>{f.name}</span>
                  <span style={{ color: "var(--eoc-text-muted)", fontSize: "0.85em" }}>
                    {f.kind} · {f.mode}
                  </span>
                  {f.mode === "poll" ? (
                    <Button onClick={() => run(() => props.client.pollFeed(f.id))} disabled={busy}>
                      Poll now
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>

        {error ? (
          <p role="alert" style={{ color: "var(--eoc-status-critical)" }}>
            {error}
          </p>
        ) : null}
      </div>
    </Scroll>
  );
}
