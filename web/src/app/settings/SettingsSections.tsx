import { useEffect, useState, type FormEvent } from "react";
import type { ApiClient } from "../api/client.js";
import { syntheticData } from "../config.js";
import { setPreferences, usePreferences } from "../preferences.js";
import { desktopAlertsSupported, playAlertTone } from "../../notifications/alerting.js";
import type { SettingsSection } from "../layout/ShellDialogs.js";
import { DevicePinSettings, type DevicePinNoticeProps } from "../../offline/DevicePin.js";

/** The console's own settings sections; the shell adds General (navigation and administration). */
export function consoleSettingsSections(props: {
  readonly client: ApiClient;
  readonly email: string;
  readonly displayName: string;
  readonly onLogout: () => void;
  /** The device PIN (VC-27): set, offered, or one click away. */
  readonly devicePin: DevicePinNoticeProps;
}): readonly SettingsSection[] {
  return [
    { key: "account", title: "Account", content: <AccountSettings {...props} /> },
    { key: "notifications", title: "Notifications", content: <NotificationSettings /> },
    { key: "map", title: "Map", content: <MapSettings /> },
    { key: "device", title: "This computer", content: <DeviceSettings devicePin={props.devicePin} /> },
    { key: "about", title: "About", content: <AboutSettings client={props.client} /> },
  ];
}

function AccountSettings(props: { readonly client: ApiClient; readonly email: string; readonly displayName: string; readonly onLogout: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ readonly kind: "error" | "done"; readonly text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (next.length < 12) return setMessage({ kind: "error", text: "The new password needs at least 12 characters." });
    if (next !== confirm) return setMessage({ kind: "error", text: "The new password and its confirmation differ." });
    setBusy(true);
    try {
      const result = await props.client.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      const others = result.otherSessionsEnded;
      setMessage({ kind: "done", text: `Password changed.${others > 0 ? ` ${others === 1 ? "One other session was" : `${others} other sessions were`} signed out.` : ""}` });
    } catch (cause) {
      setMessage({ kind: "error", text: cause instanceof Error ? cause.message : "The password could not be changed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <fieldset>
        <legend>Signed in as</legend>
        <p className="eoc-shell-settings-value"><strong>{props.displayName}</strong><span>{props.email}</span></p>
        <button type="button" className="eoc-kit-button" onClick={props.onLogout}>Sign out</button>
      </fieldset>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset>
          <legend>Change password</legend>
          <label className="is-field">Current password
            <input type="password" autoComplete="current-password" value={current} required onChange={(event) => setCurrent(event.target.value)} />
          </label>
          <label className="is-field">New password
            <input type="password" autoComplete="new-password" value={next} required minLength={12} onChange={(event) => setNext(event.target.value)} />
          </label>
          <label className="is-field">Confirm new password
            <input type="password" autoComplete="new-password" value={confirm} required onChange={(event) => setConfirm(event.target.value)} />
          </label>
          <p>At least 12 characters. Your other signed-in sessions end when it changes.</p>
          {message ? <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "eoc-text-critical" : "eoc-text-success"}>{message.text}</p> : null}
          <button type="submit" className="eoc-kit-button is-primary" disabled={busy}>{busy ? "Changing…" : "Change password"}</button>
        </fieldset>
      </form>
    </>
  );
}

function NotificationSettings() {
  const prefs = usePreferences();
  const supported = desktopAlertsSupported();
  const [permission, setPermission] = useState(() => (supported ? Notification.permission : "denied"));

  async function chooseDesktopAlerts(on: boolean) {
    if (!on) return setPreferences({ desktopAlerts: false });
    const granted = permission === "granted" ? "granted" : await Notification.requestPermission();
    setPermission(granted);
    setPreferences({ desktopAlerts: granted === "granted" });
  }

  return (
    <fieldset>
      <legend>When something is addressed to you</legend>
      <label>
        <input type="checkbox" checked={prefs.desktopAlerts} disabled={!supported}
          onChange={(event) => void chooseDesktopAlerts(event.target.checked)} />
        Show a desktop alert
      </label>
      <p>
        {!supported ? "This browser shows no desktop alerts."
          : permission === "denied" ? "This browser blocks alerts from this page. Allow notifications for it in the browser's site settings, then turn this on."
            : "Windows or macOS shows the alert even while the console is in the background."}
      </p>
      <label>
        <input type="checkbox" checked={prefs.alertSound} onChange={(event) => setPreferences({ alertSound: event.target.checked })} />
        Play a sound
      </label>
      <div className="eoc-shell-settings-row">
        <button type="button" className="eoc-kit-button" onClick={playAlertTone}>Play the sound</button>
        <button type="button" className="eoc-kit-button" disabled={!prefs.desktopAlerts || permission !== "granted"}
          onClick={() => new Notification("Open Source EOC", { body: "Desktop alerts are on for this computer." })}>Send a test alert</button>
      </div>
      <p>Only notifications that arrive while the console is open alert. Saved on this computer.</p>
    </fieldset>
  );
}

function MapSettings() {
  const prefs = usePreferences();
  return (
    <>
      <fieldset>
        <legend>Distances</legend>
        {([["imperial", "Miles and feet"], ["metric", "Kilometers and meters"]] as const).map(([value, label]) => (
          <label key={value}>
            <input type="radio" name="eoc-settings-distance" checked={prefs.distanceUnit === value} onChange={() => setPreferences({ distanceUnit: value })} />
            {label}
          </label>
        ))}
        <p>The Map screen's scale bar and its distance and area measurements.</p>
      </fieldset>
      <fieldset>
        <legend>Coordinates</legend>
        {([["decimal", "Decimal degrees (40.8021, -124.1637)"], ["dms", "Degrees, minutes and seconds (40°48'07.6\"N)"]] as const).map(([value, label]) => (
          <label key={value}>
            <input type="radio" name="eoc-settings-coordinates" checked={prefs.coordinateFormat === value} onChange={() => setPreferences({ coordinateFormat: value })} />
            {label}
          </label>
        ))}
        <label>
          <input type="checkbox" checked={prefs.gridReference} onChange={(event) => setPreferences({ gridReference: event.target.checked })} />
          Show USNG and MGRS grid references
        </label>
        <p>The readout in the map's corner. Saved on this computer.</p>
      </fieldset>
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => globalThis.navigator?.onLine ?? true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    globalThis.addEventListener("online", update);
    globalThis.addEventListener("offline", update);
    return () => {
      globalThis.removeEventListener("online", update);
      globalThis.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

function DeviceSettings(props: { readonly devicePin: DevicePinNoticeProps }) {
  const online = useOnline();
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void navigator.serviceWorker?.getRegistration().then((registration) => setInstalled(Boolean(registration?.active))).catch(() => setInstalled(false));
    void navigator.storage?.estimate().then((estimate) => setUsage(estimate.usage === undefined ? null : formatBytes(estimate.usage))).catch(() => undefined);
    void navigator.storage?.persisted().then(setPersisted).catch(() => undefined);
  }, []);

  async function keep() {
    const granted = await navigator.storage.persist();
    setPersisted(granted);
    setNote(granted ? "The browser keeps this computer's copy even when storage runs low." : "The browser did not agree to keep the copy; it may clear it when storage runs low.");
  }

  async function clearCopy() {
    for (const key of await caches.keys()) await caches.delete(key);
    const registration = await navigator.serviceWorker?.getRegistration();
    await registration?.unregister();
    globalThis.location.reload();
  }

  return (
    <>
      <DevicePinSettings {...props.devicePin} />
      <fieldset>
        <legend>Offline copy</legend>
        <dl className="eoc-shell-settings-facts">
          <div><dt>Connection</dt><dd>{online ? "Connected to the server" : "No connection; working from this computer's copy"}</dd></div>
          <div><dt>Offline copy</dt><dd>{installed === null ? "Checking…" : installed ? "Kept on this computer: the console opens without a connection" : "Not kept yet"}</dd></div>
          <div><dt>Storage used</dt><dd>{usage ?? "Unknown"}</dd></div>
          <div><dt>Kept when storage runs low</dt><dd>{persisted === null ? "Unknown" : persisted ? "Yes" : "No"}</dd></div>
        </dl>
        {persisted === false ? <button type="button" className="eoc-kit-button" onClick={() => void keep()}>Keep this computer's copy</button> : null}
        {note ? <p role="status">{note}</p> : null}
      </fieldset>
      <fieldset>
        <legend>Clear this computer's copy</legend>
        <p>Removes the stored console and map files, for a shared computer or to load a fresh copy. Reports and drafts waiting to be sent stay. The console reloads from the server, so it needs a connection.</p>
        {confirming ? (
          <div className="eoc-shell-settings-row">
            <button type="button" className="eoc-kit-button is-danger" onClick={() => void clearCopy()}>Clear and reload</button>
            <button type="button" className="eoc-kit-button" onClick={() => setConfirming(false)}>Keep it</button>
          </div>
        ) : (
          <button type="button" className="eoc-kit-button" disabled={!online || !installed} onClick={() => setConfirming(true)}>Clear the offline copy</button>
        )}
      </fieldset>
    </>
  );
}

function AboutSettings(props: { readonly client: ApiClient }) {
  const online = useOnline();
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    void props.client.serverHealth().then((health) => setVersion(health.version)).catch(() => setVersion(null));
  }, [props.client]);
  return (
    <fieldset>
      <legend>Open Source EOC</legend>
      <dl className="eoc-shell-settings-facts">
        <div><dt>Version</dt><dd>{version ?? (online ? "Checking…" : "Unavailable offline")}</dd></div>
        <div><dt>Server</dt><dd>{globalThis.location.origin}</dd></div>
        <div><dt>Connection</dt><dd>{online ? "Connected" : "Offline"}</dd></div>
        <div><dt>Data</dt><dd>{syntheticData() ? "Demonstration · Synthetic data" : "Operational"}</dd></div>
        <div><dt>License</dt><dd>Apache License 2.0. The installed application's THIRD-PARTY-NOTICES.txt lists the software and map data it carries.</dd></div>
      </dl>
    </fieldset>
  );
}
