import { useState } from "react";
import { Button, EnumSelect, Panel, TextField } from "../../design/components.js";
import { Icon } from "../../design/icons/index.js";
import { FeedReadiness } from "../../feeds/FeedReadiness.js";
import "../../feeds/feeds.css";
import { FEED_PRESETS, FEED_PRESET_BY_KIND, type FeedPreset } from "../../cop/feeds.js";
import type { ApiClient } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { ErrorNote, Loading, Scroll, SurfaceHeader } from "../screens/parts.js";

const KINDS = ["geojson", "cap", "georss", "cot"] as const;
const INTERVALS = ["60", "300", "900", "3600", "21600"] as const;
const FRESHNESS = ["300", "900", "3600", "21600", "86400"] as const;
const INTERVAL_LABELS = { "60": "1 minute", "300": "5 minutes", "900": "15 minutes", "3600": "1 hour", "21600": "6 hours" };
const FRESHNESS_LABELS = { "300": "5 minutes", "900": "15 minutes", "3600": "1 hour", "21600": "6 hours", "86400": "1 day" };
type FeedKind = (typeof KINDS)[number];
const PRESET_TITLES = Object.fromEntries(FEED_PRESETS.map((preset) => [preset.kind, preset.title]));

/** "5 minutes", "1 hour", "1 day". */
function every(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400} day${seconds === 86400 ? "" : "s"}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? "" : "s"}`;
  return `${Math.round(seconds / 60)} minutes`;
}

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
  const [mode, setMode] = useState("poll");
  const [url, setUrl] = useState("");
  const [interval, setIntervalValue] = useState("300");
  const [freshness, setFreshness] = useState("900");
  const [creating, setCreating] = useState(false);
  const [busyFeedId, setBusyFeedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [preset, setPreset] = useState<FeedPreset>(FEED_PRESETS[0]!);
  const [presetInput, setPresetInput] = useState(FEED_PRESETS[0]!.input.initial);

  const submit = async (spec: () => Parameters<ApiClient["createFeed"]>[1]) => {
    setCreating(true);
    setError(null);
    setToken(null);
    try {
      const r = await props.client.createFeed(props.jurisdictionId, spec());
      setName("");
      setUrl("");
      setToken(r.ingestToken ?? null);
      setReload((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreating(false);
    }
  };

  const create = () => submit(() => {
    if (!name.trim()) throw new Error("Enter a feed name.");
    if (mode === "poll" && !url.trim()) throw new Error("Enter the source URL for a poll feed.");
    return {
      name: name.trim(),
      kind,
      push: mode === "push",
      ...(mode === "poll" ? { url: url.trim(), pollIntervalSeconds: Number(interval) } : {}),
      staleAfterSeconds: Number(freshness),
    };
  });

  /** One step: the preset's source URL for the input, its own poll interval and freshness window. */
  const addPreset = () => submit(() => {
    const sourceUrl = preset.url(presetInput);
    const detail = preset.input.choices?.[presetInput] ?? (preset.input.initial ? presetInput.trim().toUpperCase() : "");
    return {
      name: detail ? `${preset.title} (${detail})` : preset.title,
      kind: preset.kind,
      url: sourceUrl,
      pollIntervalSeconds: preset.pollIntervalSeconds,
      staleAfterSeconds: preset.staleAfterSeconds,
    };
  });

  const choosePreset = (kind: string) => {
    const next = FEED_PRESET_BY_KIND.get(kind)!;
    setPreset(next);
    setPresetInput(next.input.initial);
  };

  const poll = async (feedId: string) => {
    setBusyFeedId(feedId);
    setError(null);
    try {
      const result = await props.client.pollFeed(feedId);
      if (result.ok === false) setError(String(result.error ?? "Feed update failed."));
      setReload((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyFeedId(null);
    }
  };

  return (
    <Scroll>
      <SurfaceHeader title="Feeds" />
      <div className="d21-workspace">
        <div className="d21-workspace-intro">
          <Icon name="feeds" size={32} decorative />
          <div><strong>Live source administration</strong><span>Feed health reports the latest attempt separately from stored last-good items. Parser failures never look like a successful empty feed.</span></div>
        </div>
        {error ? <p className="d21-error" role="alert">{error}</p> : null}
        {props.isAdmin ? (
        <Panel title="Add a live hazard feed">
          <div className="d21-form-grid">
            <EnumSelect label="Preset" values={FEED_PRESETS.map((p) => p.kind)} labels={PRESET_TITLES} value={preset.kind} onChange={choosePreset} />
            {preset.input.choices
              ? <EnumSelect label={preset.input.label} values={Object.keys(preset.input.choices)} labels={preset.input.choices} value={presetInput} onChange={setPresetInput} />
              : <TextField label={preset.input.label} value={presetInput} onChange={setPresetInput} required />}
          </div>
          <dl className="d21-metrics" aria-label="Preset source">
            <div><dt>Source</dt><dd>{preset.source}</dd></div>
            <div><dt>Terms</dt><dd>{preset.terms}</dd></div>
            <div><dt>Updates</dt><dd>Every {every(preset.pollIntervalSeconds)}</dd></div>
            <div><dt>Stale after</dt><dd>{every(preset.staleAfterSeconds)}</dd></div>
          </dl>
          <div className="d21-toolbar">
            <span className="d21-muted">Off until added. Without a connection the map keeps the last snapshot, grey and labeled with its age.</span>
            <Button kind="primary" onClick={() => void addPreset()} disabled={creating}>{creating ? "Adding…" : "Add preset"}</Button>
          </div>
        </Panel>
        ) : null}
        {props.isAdmin ? (
        <Panel title="Add a feed">
          <div className="d21-form-grid">
            <TextField label="Feed name" value={name} onChange={setName} required />
            <EnumSelect label="Format" values={KINDS} value={kind} onChange={(value) => setKind(value as FeedKind)} />
            <EnumSelect label="Delivery" values={["poll", "push"]} labels={{ poll: "Poll an upstream URL", push: "Receive authenticated pushes" }} value={mode} onChange={setMode} />
            <EnumSelect label="Freshness window" values={FRESHNESS} labels={FRESHNESS_LABELS} value={freshness} onChange={setFreshness} />
            {mode === "poll" ? <>
              <div className="d21-form-grid-wide"><TextField label="Source URL" value={url} onChange={setUrl} required /></div>
              <EnumSelect label="Poll interval" values={INTERVALS} labels={INTERVAL_LABELS} value={interval} onChange={setIntervalValue} />
            </> : <p className="d21-feed-form-note d21-form-grid-wide">A one-time ingest token is shown after creation. Store it in the sending system; it cannot be displayed again.</p>}
          </div>
          <div className="d21-toolbar">
            <span className="d21-muted">Creating a feed registers the adapter. Readiness begins after its first accepted update.</span>
            <Button kind="primary" onClick={() => void create()} disabled={creating}>{creating ? "Adding…" : "Add feed"}</Button>
          </div>
          {token ? <p className="d21-token" role="status"><strong className="d21-feed-token-heading">Push ingest token · shown once</strong><code>{token}</code></p> : null}
        </Panel>
        ) : null}

        <Panel title="Feed readiness">
          {feeds.loading && !feeds.data ? <Loading label="Loading feed readiness…" /> : null}
          {feeds.error ? <ErrorNote message={feeds.error} /> : null}
          <FeedReadiness feeds={feeds.data ?? []} isAdmin={props.isAdmin} busyFeedId={busyFeedId} onPoll={(id) => void poll(id)} />
          <div className="d21-toolbar">
            <span className="d21-muted">Stored item counts describe the last-good layer. Per-record rejected counts are unavailable for all-or-fail feed adapters.</span>
            <Button onClick={() => setReload((value) => value + 1)} disabled={feeds.loading}>Refresh health</Button>
          </div>
        </Panel>
      </div>
    </Scroll>
  );
}
