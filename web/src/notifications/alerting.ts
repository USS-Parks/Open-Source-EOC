import { useEffect, useRef } from "react";
import type { RawNotification } from "../app/api/client.js";
import { usePreferences } from "../app/preferences.js";

/** A short two-note tone, made in the browser, so it plays with no network and no sound file. */
export function playAlertTone(): void {
  const Context = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return;
  const audio = new Context();
  const gain = audio.createGain();
  gain.connect(audio.destination);
  gain.gain.setValueAtTime(0.0001, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.2, audio.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.5);
  for (const [frequency, start] of [[880, 0], [1175, 0.18]] as const) {
    const tone = audio.createOscillator();
    tone.type = "sine";
    tone.frequency.value = frequency;
    tone.connect(gain);
    tone.start(audio.currentTime + start);
    tone.stop(audio.currentTime + start + 0.3);
  }
  globalThis.setTimeout(() => void audio.close(), 900);
}

export function desktopAlertsSupported(): boolean {
  return typeof globalThis.Notification === "function";
}

/**
 * Alerts for notifications that arrive while the console is open, as the
 * viewer's settings ask: a tone, a system notification, or both. What was
 * already there when the console opened never alerts.
 */
export function useArrivalAlerts(items: readonly RawNotification[] | null | undefined): void {
  const { desktopAlerts, alertSound } = usePreferences();
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!items) return;
    if (seen.current === null) {
      seen.current = new Set(items.map((item) => item.id));
      return;
    }
    const known = seen.current;
    const arrived = items.filter((item) => !known.has(item.id) && item.assigned_to_current_actor && !item.read_at);
    for (const item of items) known.add(item.id);
    if (arrived.length === 0) return;
    if (alertSound) playAlertTone();
    if (desktopAlerts && desktopAlertsSupported() && Notification.permission === "granted") {
      for (const item of arrived.slice(0, 3)) new Notification(item.title, { body: item.body, tag: item.id });
    }
  }, [items, desktopAlerts, alertSound]);
}
