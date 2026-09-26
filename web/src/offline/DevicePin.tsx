import { useEffect, useId, useState, type FormEvent } from "react";
import type { LockedFor } from "../app/auth/session.js";
import { Button, Panel } from "../design/components.js";
import { IDLE_LOCK_MS, MIN_PIN_LENGTH, pinProblem, readVault, type UnlockResult } from "./device-lock.js";
import "../app/auth/sign-in.css";
import "./device-pin.css";

/** The device PIN screens and the dock card (VC-27). */

function duration(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function PinInput(props: { label: string; value: string; onChange: (value: string) => void; hint?: string }) {
  const id = useId();
  return (
    <p className="eoc-input-field">
      <label htmlFor={id}>{props.label}</label>
      {/* autocomplete off: the browser is asked not to fill it in for whoever uses this device next. */}
      <input id={id} className="eoc-input" type="password" autoComplete="off" value={props.value}
        aria-describedby={props.hint ? `${id}-hint` : undefined} onChange={(event) => props.onChange(event.target.value)} />
      {props.hint ? <span id={`${id}-hint`} className="eoc-device-pin-hint">{props.hint}</span> : null}
    </p>
  );
}

const PIN_HINT = `At least ${MIN_PIN_LENGTH} digits or characters. A longer PIN is harder to guess from a copy of this device's storage.`;

export interface DeviceUnlockProps {
  readonly lockedFor: LockedFor;
  readonly error: string | null;
  readonly onUnlock: (pin: string) => Promise<UnlockResult>;
  readonly onUsePassword: () => void;
  readonly onErase: () => Promise<void>;
}

/** The PIN screen: what this device keeps for a person opens only with their PIN. */
export function DeviceUnlock(props: DeviceUnlockProps) {
  const { personId, label, proven } = props.lockedFor;
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState(0);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [wrong, setWrong] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // A wait or wrong tries from before a reload still apply.
  useEffect(() => {
    let active = true;
    void readVault(personId).then((vault) => {
      if (!active || !vault) return;
      setWaitUntil(vault.lockedUntil);
      if (vault.failures > 0) setAttemptsLeft(vault.attemptsLeft);
    }, () => undefined);
    return () => { active = false; };
  }, [personId]);

  const waiting = waitUntil > now;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await props.onUnlock(pin);
      if (result.ok) return;
      setPin("");
      setWrong(result.reason === "wrong");
      setAttemptsLeft(result.attemptsLeft);
      setNow(Date.now());
      setWaitUntil(Date.now() + result.waitMs);
    } finally {
      setBusy(false);
    }
  }

  const erasing = attemptsLeft === null ? null
    : `${attemptsLeft} ${attemptsLeft === 1 ? "try" : "tries"} left before this device erases the work it keeps for ${label}, including work not yet sent.`;
  const message = waiting
    ? `${wrong ? "That PIN is not right. " : ""}Too many wrong PINs: try again in ${duration(waitUntil - now)}. ${erasing ?? ""}`
    : wrong ? `That PIN is not right. ${erasing ?? ""}` : erasing;

  return (
    <main className="sign-in-frame">
      <form className="sign-in-box" onSubmit={(event) => void submit(event)}>
        <Panel title="Unlock this device" level={1}>
          <p className="sign-in-lead">
            This device keeps work for <strong>{label || "another person"}</strong>. Enter the device PIN to open it.
          </p>
          <div className="eoc-stack">
            <PinInput label="Device PIN" value={pin} onChange={setPin} />
            {props.error ? <p role="alert" className="eoc-flush eoc-text-critical">{props.error}</p> : null}
            {message ? <p role="status" className="eoc-flush eoc-text-critical">{message.trim()}</p> : null}
            <Button kind="primary" type="submit" disabled={busy || waiting || pin.length === 0}>
              {busy ? "Opening…" : "Unlock"}
            </Button>
            <Button onClick={props.onUsePassword}>{proven ? "Sign in as someone else" : "Sign in with a password instead"}</Button>
            {proven ? (
              confirming ? (
                <div className="eoc-device-pin-erase" role="group" aria-label="Erase this device's copy">
                  <p className="eoc-flush">
                    This erases everything this device keeps for {label}, including work not yet sent. It cannot be undone.
                  </p>
                  <Button kind="danger" onClick={() => void props.onErase()}>Erase and continue</Button>
                  <Button onClick={() => setConfirming(false)}>Keep it</Button>
                </div>
              ) : (
                <Button onClick={() => setConfirming(true)}>Forgot the PIN? Erase this device's copy</Button>
              )
            ) : null}
          </div>
        </Panel>
      </form>
    </main>
  );
}

/** Two PIN fields and a button; resolves when the PIN is set. */
function DevicePinForm(props: { readonly onSet: (pin: string) => Promise<void> }) {
  const [pin, setPin] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const wrong = pinProblem(pin, repeat);
    setProblem(wrong);
    if (wrong) return;
    setBusy(true);
    try {
      await props.onSet(pin);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "The device PIN could not be set.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="eoc-stack" aria-label="Set a device PIN" onSubmit={(event) => void submit(event)}>
      <PinInput label="New device PIN" value={pin} onChange={setPin} hint={PIN_HINT} />
      <PinInput label="Repeat the PIN" value={repeat} onChange={setRepeat} />
      {problem ? <p role="alert" className="eoc-flush eoc-text-critical">{problem}</p> : null}
      <Button kind="primary" type="submit" disabled={busy}>{busy ? "Sealing…" : "Set device PIN"}</Button>
    </form>
  );
}

const IDLE_MINUTES = IDLE_LOCK_MS / 60_000;
const UNPROTECTED = "Anyone who uses this device can read the drafts and queued work it keeps for you. A device PIN encrypts them.";
const SEALED = `What this device keeps for you is encrypted and opens only with your PIN. It asks for the PIN when the app starts and after ${IDLE_MINUTES} minutes without use.`;

export interface DevicePinNoticeProps {
  readonly devicePin: boolean;
  /** The unprotected notice still stands: the person has not answered Not now in this page. */
  readonly offer: boolean;
  readonly onSet: (pin: string) => Promise<void>;
  readonly onLock: () => void;
  readonly onDismiss: () => void;
}

/** Set device PIN, one click to the form, and Not now where the notice was not asked for. */
function SetOrDismiss(props: { readonly onSet: (pin: string) => Promise<void>; readonly onDismiss?: () => void }) {
  const [open, setOpen] = useState(false);
  if (open) return <DevicePinForm onSet={props.onSet} />;
  return (
    <div className="eoc-device-pin-actions">
      <Button kind="primary" onClick={() => setOpen(true)}>Set device PIN</Button>
      {props.onDismiss ? <Button onClick={props.onDismiss}>Not now</Button> : null}
    </div>
  );
}

/** Above the console after sign-in, while the person keeps work here unprotected: a PIN offered, never required. */
export function DevicePinOffer(props: DevicePinNoticeProps) {
  if (props.devicePin || !props.offer) return null;
  return (
    <section className="eoc-device-pin-offer" aria-label="Device PIN">
      <p><strong>This device keeps your work unprotected.</strong> {UNPROTECTED}</p>
      <SetOrDismiss onSet={props.onSet} onDismiss={props.onDismiss} />
    </section>
  );
}

/** In the console's dock, under the continuity panel: how this device keeps the person's work. */
export function DevicePinCard(props: DevicePinNoticeProps) {
  if (!props.devicePin && !props.offer) return null;
  return (
    <section className="eoc-device-pin" aria-label="This device">
      <header>
        <span>This device</span>
        <h2>{props.devicePin ? "Kept under your device PIN" : "Kept unprotected"}</h2>
      </header>
      {props.devicePin ? (
        <>
          <p>{SEALED}</p>
          <Button onClick={props.onLock}>Lock now</Button>
        </>
      ) : (
        <>
          <p>{UNPROTECTED} It then asks for the PIN when the app starts.</p>
          <SetOrDismiss onSet={props.onSet} onDismiss={props.onDismiss} />
        </>
      )}
    </section>
  );
}

/** Settings > This computer: the device PIN, always one click away. */
export function DevicePinSettings(props: DevicePinNoticeProps) {
  return (
    <fieldset className="eoc-device-pin-settings">
      <legend>Device PIN</legend>
      {props.devicePin ? (
        <>
          <p>Set. {SEALED}</p>
          <Button onClick={props.onLock}>Lock now</Button>
        </>
      ) : (
        <>
          <p>Not set. {UNPROTECTED} A shared device should have one for each person who uses it.</p>
          <SetOrDismiss onSet={props.onSet} {...(props.offer ? { onDismiss: props.onDismiss } : {})} />
        </>
      )}
    </fieldset>
  );
}
