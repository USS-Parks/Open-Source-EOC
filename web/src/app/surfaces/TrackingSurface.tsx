import { useEffect, useState, type FormEvent } from "react";
import { dictionaryValues } from "@openeoc/shared";
import { ActionButton, Tabs } from "../../design/controls.js";
import { ConditionBadge, EmptyState, ErrorState, LoadingState } from "../../design/feedback.js";
import { Icon } from "../../design/icons/Icon.js";
import type { ApiClient, ReunificationAnswer, TrackedObject } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { Scroll, SurfaceHeader } from "../screens/parts.js";
import "../../field/field-workspace.css";

const KINDS = dictionaryValues("tracking.kinds") ?? ["patient"];
const CUSTODY = dictionaryValues("tracking.custody_states") ?? ["registered"];
type TrackingTab = "scan" | "register" | "find";

function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const refresh = () => setOnline(navigator.onLine);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
    };
  }, []);
  return online;
}

async function detectBarcode(file: File): Promise<string | null> {
  const api = globalThis as typeof globalThis & {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect(source: ImageBitmap): Promise<Array<{ rawValue?: string }>>;
    };
  };
  if (!api.BarcodeDetector) return null;
  const bitmap = await createImageBitmap(file);
  try {
    const [result] = await new api.BarcodeDetector({ formats: ["qr_code", "code_128", "code_39"] }).detect(bitmap);
    return result?.rawValue?.trim() || null;
  } finally {
    bitmap.close();
  }
}

function human(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Scan-first custody workflow over the existing attributed tracking service. */
export function TrackingSurface(props: { client: ApiClient; jurisdictionId: string }) {
  const online = useOnline();
  const [tab, setTab] = useState<TrackingTab>("scan");
  const [kind, setKind] = useState<string>(KINDS[0] ?? "patient");
  const [label, setLabel] = useState("");
  const [tag, setTag] = useState("");
  const [scanTag, setScanTag] = useState("");
  const [custodyState, setCustodyState] = useState<string>(CUSTODY[0] ?? "registered");
  const [station, setStation] = useState("");
  const [agency, setAgency] = useState("");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReunificationAnswer[] | null>(null);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [busy, setBusy] = useState(false);
  const [chainId, setChainId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const recent = useAsync(
    () => props.client.reunify(props.jurisdictionId, { label: "" }),
    [props.client, props.jurisdictionId],
  );

  const run = async (work: () => Promise<void>) => {
    if (!online) {
      setError("Tracking registration and custody scans require a connection. Nothing was queued.");
      return;
    }
    setBusy(true); setError(null); setMessage(null);
    try {
      await work();
      recent.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Tracking action failed.");
    } finally {
      setBusy(false);
    }
  };

  const register = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (!label.trim()) throw new Error("Enter a field-safe label.");
      const result = await props.client.registerTrackedObject(props.jurisdictionId, {
        kind,
        label: label.trim(),
        ...(tag.trim() ? { tag: tag.trim() } : {}),
        ...(station.trim() ? { station: station.trim() } : {}),
        ...(agency.trim() ? { agency: agency.trim() } : {}),
        ...(location.trim() ? { location: location.trim() } : {}),
      });
      setScanTag(result.tag); setLabel(""); setTag("");
      setMessage(`Registered ${result.tag}. Continue with the first custody handoff.`);
      setTab("scan");
    });
  };

  const scan = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (!scanTag.trim()) throw new Error("Scan or enter a tracking tag.");
      await props.client.scanTrackedObject(props.jurisdictionId, {
        tag: scanTag.trim(), custodyState,
        ...(station.trim() ? { station: station.trim() } : {}),
        ...(agency.trim() ? { agency: agency.trim() } : {}),
        ...(location.trim() ? { location: location.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setMessage(`Custody receipt recorded for ${scanTag.trim()}: ${human(custodyState)}.`);
      setNote("");
    });
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    if (!online) {
      setSearchState("error");
      setError("Tracking registration and custody scans require a connection. Nothing was queued.");
      return;
    }
    setBusy(true); setError(null); setMessage(null); setSearchState("loading");
    void (async () => {
      try {
      const value = query.trim();
      setResults(await props.client.reunify(props.jurisdictionId,
        value.startsWith("#") ? { tag: value.slice(1) } : { label: value }));
        setSearchState("ready");
      } catch (reason) {
        setSearchState("error");
        setError(reason instanceof Error ? reason.message : "Tracking search failed.");
      } finally {
        setBusy(false);
      }
    })();
  };

  const showingSearch = searchState !== "idle";
  const list = showingSearch ? results ?? [] : recent.data ?? [];
  return <Scroll>
    <SurfaceHeader title="Tracking & Reunification" />
    <section className="eoc-field-workspace" aria-label="Tracking and reunification">
      <section className="eoc-field-hero">
        <div><span className="eoc-field-eyebrow">Scan-first custody</span><h2>Keep each handoff attached to one tag</h2>
          <p>Registration and every custody change retain the signed-in operator and server time. Restricted details are not shown here.</p></div>
        <div className={`eoc-field-sync ${online ? "eoc-field-sync--synced" : "eoc-field-sync--offline"}`} role="status">
          <Icon name="tracking" decorative size={20} /><div><strong>{online ? "Online" : "Offline"}</strong>
            <span>{online ? "Custody actions write directly to the authoritative chain." : "Tracking has no offline receipt path. Reconnect before acting."}</span></div>
        </div>
      </section>

      <Tabs id="tracking-workflow" label="Tracking workflow" value={tab} onChange={(value) => setTab(value as TrackingTab)} tabs={[
        { id: "scan", label: "Scan handoff" }, { id: "register", label: "Register" }, { id: "find", label: "Find & reunify" },
      ]} />

      <section className="eoc-field-form" role="tabpanel" id="tracking-workflow-scan-panel" aria-labelledby="tracking-workflow-scan-tab" hidden={tab !== "scan"}>{tab === "scan" ? <>
        <header><div><span className="eoc-field-eyebrow">Custody receipt</span><h2 id="tracking-scan-title">Record a handoff</h2></div></header>
        <form onSubmit={scan}>
          <div className="eoc-field-scan-row"><label>Tracking tag<input required autoFocus inputMode="text" value={scanTag}
            onChange={(event) => setScanTag(event.target.value)} placeholder="TRK-1234ABCD" /></label>
            <label className="eoc-field-camera">Scan barcode or QR<input type="file" accept="image/*" capture="environment" disabled={!online || busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setError(null);
                void detectBarcode(file)
                  .then((value) => value ? setScanTag(value) : setError("This browser could not read the code. Enter the tag manually."))
                  .catch(() => setError("This image could not be read. Enter the tag manually."));
              }} /></label></div>
          <div className="eoc-field-selector-grid">
            <label>Custody state<select value={custodyState} onChange={(event) => setCustodyState(event.target.value)}>
              {CUSTODY.map((value) => <option key={value} value={value}>{human(value)}</option>)}</select></label>
            <label>Station<input value={station} onChange={(event) => setStation(event.target.value)} /></label>
            <label>Agency<input value={agency} onChange={(event) => setAgency(event.target.value)} /></label>
            <label>Location<input value={location} onChange={(event) => setLocation(event.target.value)} /></label>
          </div>
          <label>Handoff note<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <ActionButton kind="primary" type="submit" loading={busy} loadingLabel="Recording custody…" disabled={!online}>Record custody handoff</ActionButton>
        </form>
      </> : null}</section>

      <section className="eoc-field-form" role="tabpanel" id="tracking-workflow-register-panel" aria-labelledby="tracking-workflow-register-tab" hidden={tab !== "register"}>{tab === "register" ? <>
        <header><div><span className="eoc-field-eyebrow">Minimal registration</span><h2 id="tracking-register-title">Issue or attach a tag</h2></div></header>
        <form onSubmit={register}>
          <div className="eoc-field-selector-grid">
            <label>Tracked kind<select value={kind} onChange={(event) => setKind(event.target.value)}>
              {KINDS.map((value) => <option key={value} value={value}>{human(value)}</option>)}</select></label>
            <label>Field-safe label<input required value={label} onChange={(event) => setLabel(event.target.value)} /></label>
            <label>Existing tag, optional<input value={tag} onChange={(event) => setTag(event.target.value)} /></label>
            <label>Initial station<input value={station} onChange={(event) => setStation(event.target.value)} /></label>
            <label>Agency<input value={agency} onChange={(event) => setAgency(event.target.value)} /></label>
            <label>Location<input value={location} onChange={(event) => setLocation(event.target.value)} /></label>
          </div>
          <p className="eoc-field-note">Use a field-safe label. Health and full identity details belong in restricted workflows and are not collected on this screen.</p>
          <ActionButton kind="primary" type="submit" loading={busy} loadingLabel="Registering…" disabled={!online}>Register tracked object</ActionButton>
        </form>
      </> : null}</section>

      <section className="eoc-field-form" role="tabpanel" id="tracking-workflow-find-panel" aria-labelledby="tracking-workflow-find-tab" hidden={tab !== "find"}>{tab === "find" ? <>
        <header><div><span className="eoc-field-eyebrow">Public-safe whereabouts</span><h2 id="tracking-find-title">Find and continue custody</h2></div></header>
        <form className="eoc-field-search" onSubmit={search}><label>Name, field-safe label, or #tag<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <ActionButton kind="secondary" type="submit" loading={busy} disabled={!online}>Search</ActionButton></form>
        {chainId ? <CustodyChain key={chainId} client={props.client} objectId={chainId} onClose={() => setChainId(null)} /> : null}
        {showingSearch && searchState === "loading" ? <LoadingState label="Searching tracked objects…" />
          : showingSearch && searchState === "error" ? <ErrorState title="Tracking search unavailable" message={error ?? "Tracking search failed."} />
            : !showingSearch && recent.loading && !recent.data ? <LoadingState label="Loading tracked objects…" />
              : !showingSearch && recent.error ? <ErrorState title="Tracking inventory unavailable" message={recent.error} />
                : list.length === 0 ? <EmptyState title="No tracked objects found" description="Register an object or broaden the field-safe search." />
                  : <ul className="eoc-field-inventory" aria-label={results ? "Tracking search results" : "Recent tracked objects"}>{list.map((item) => <li key={item.tag}>
            <ConditionBadge state={item.latest?.custodyState === "reunified" ? "normal" : "watch"} label={item.latest ? human(item.latest.custodyState) : "Unknown"} />
            <div><strong>{item.label}</strong><span>{human(item.kind)} · #{item.tag}</span><small>{item.latest?.station ?? item.latest?.location ?? "Location not reported"}</small></div>
            <p className="eoc-field-item-actions">
              <ActionButton kind="quiet" onClick={() => setChainId(item.id)}>Custody chain</ActionButton>
              <ActionButton kind="quiet" onClick={() => { setScanTag(item.tag); setTab("scan"); }}>Continue custody</ActionButton></p>
          </li>)}</ul>}
      </> : null}</section>

      {message ? <p className="eoc-field-success" role="status">{message}</p> : null}
      {error ? <p className="eoc-field-error" role="alert">{error}</p> : null}
    </section>
  </Scroll>;
}

/** One object's custody chain, oldest first, a page at a time. Restricted details stay off this screen. */
function CustodyChain(props: { client: ApiClient; objectId: string; onClose: () => void }) {
  const first = useAsync(() => props.client.trackedObject(props.objectId), [props.client, props.objectId]);
  const [more, setMore] = useState<{ chain: TrackedObject["chain"]; next: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const object = first.data;
  const chain = [...(object?.chain ?? []), ...(more?.chain ?? [])];
  const next = more ? more.next : object?.nextCursor ?? null;
  const loadMore = async () => {
    if (!next) return;
    setLoadingMore(true); setMoreError(null);
    try {
      const page = await props.client.trackedObject(props.objectId, { cursor: next });
      setMore({ chain: [...(more?.chain ?? []), ...page.chain], next: page.nextCursor });
    } catch (reason) {
      setMoreError(reason instanceof Error ? reason.message : "The next page could not be read.");
    } finally {
      setLoadingMore(false);
    }
  };
  return <section className="eoc-field-chain" aria-label={object ? `Custody chain for ${object.label}` : "Custody chain"}>
    <header><div><span className="eoc-field-eyebrow">Custody chain</span>
      <h3>{object ? `${object.label} · #${object.tag}` : "Loading…"}</h3></div>
      <ActionButton kind="quiet" onClick={props.onClose}>Close chain</ActionButton></header>
    {first.error ? <ErrorState title="Custody chain unavailable" message={first.error} />
      : !object ? <LoadingState label="Loading the custody chain…" />
        : <ol className="eoc-field-inventory" aria-label="Custody events, oldest first">{chain.map((event, index) => <li key={index}>
          <ConditionBadge state={event.custodyState === "reunified" ? "normal" : "watch"} label={human(event.custodyState)} />
          <div><strong>{new Date(event.occurredAt).toLocaleString()}</strong>
            <span>{[event.station, event.agency, event.location].filter(Boolean).join(" · ") || "No station, agency or location recorded"}</span>
            {event.note ? <small>{event.note}</small> : null}</div>
        </li>)}</ol>}
    {next ? <ActionButton kind="secondary" loading={loadingMore} loadingLabel="Loading…" onClick={() => void loadMore()}>Show later events</ActionButton> : null}
    {moreError ? <p className="eoc-field-error" role="alert">{moreError}</p> : null}
  </section>;
}
