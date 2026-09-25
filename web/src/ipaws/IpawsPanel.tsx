import { useEffect, useState, type FormEvent } from "react";
import { ActionButton } from "../design/controls.js";
import { useAsync, usePolled } from "../app/data/hooks.js";
import { Loading } from "../app/screens/parts.js";
import {
  actorName,
  channelSummary,
  ipawsMode,
  sendAvailability,
  sendOutcome,
  timeLeft,
  type IpawsConfigInput,
  type IpawsEnvironment,
  type IpawsSendKind,
  type IpawsSendRequest,
  type IpawsSendResult,
  type IpawsStatus,
  type IpawsTrailEntry,
} from "./model.js";
import "./ipaws.css";

/**
 * The operator surface for IPAWS-OPEN: where a send would go, the admin
 * configuration (COG, MOA, enable), the request action on an approved
 * alert, and the two-person confirmation list. The server enforces every
 * rule shown here; the screen only explains and asks.
 */

export interface IpawsClient {
  getIpawsStatus(jurisdictionId: string): Promise<IpawsStatus>;
  configureIpaws(jurisdictionId: string, input: IpawsConfigInput): Promise<IpawsStatus>;
  acknowledgeIpawsMoa(jurisdictionId: string, reference: string): Promise<IpawsStatus>;
  setIpawsEnabled(jurisdictionId: string, enabled: boolean): Promise<IpawsStatus>;
  requestIpawsSend(jurisdictionId: string, alertId: string, kind: IpawsSendKind): Promise<IpawsSendRequest>;
  listIpawsSends(jurisdictionId: string): Promise<IpawsSendRequest[]>;
  confirmIpawsSend(jurisdictionId: string, sendId: string): Promise<IpawsSendResult>;
  cancelIpawsSend(jurisdictionId: string, sendId: string): Promise<IpawsSendRequest>;
  ipawsAuditTrail(jurisdictionId: string, from: string): Promise<IpawsTrailEntry[]>;
}

function failure(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Not recorded";
}

/** Where a confirmed send would go. Shown on every alerts view, to every member. */
export function IpawsModeBanner({ status, error }: { readonly status: IpawsStatus | null; readonly error: string | null }) {
  if (!status) {
    return error ? <p className="ipaws-mode" data-mode="unconfigured" role="status"><strong>IPAWS status unavailable</strong><span>{error}</span></p> : null;
  }
  const mode = ipawsMode(status);
  return (
    <p className="ipaws-mode" data-mode={mode.key} role="status">
      <strong>{mode.label}</strong>
      <span className="ipaws-mode-switch">{status.enabled ? "Enabled" : "Disabled"}</span>
      <span>{mode.detail}</span>
    </p>
  );
}

/** Admin configuration: COG and credential, MOA acknowledgement, and the enable toggle. */
export function IpawsConfigPanel(props: {
  readonly client: IpawsClient;
  readonly jurisdictionId: string;
  readonly status: IpawsStatus;
  readonly onChanged: () => void;
}) {
  const { status } = props;
  const [environment, setEnvironment] = useState<IpawsEnvironment>(status.environment);
  const [cogId, setCogId] = useState(status.cogId ?? "");
  const [endpointUrl, setEndpointUrl] = useState(status.endpointUrl ?? "");
  const [credential, setCredential] = useState("");
  const [moaReference, setMoaReference] = useState("");
  const [busy, setBusy] = useState<"config" | "moa" | "enable" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "config" | "moa" | "enable", change: () => Promise<IpawsStatus>): Promise<boolean> {
    setBusy(action);
    setError(null);
    try {
      await change();
      props.onChanged();
      return true;
    } catch (caught) {
      setError(failure(caught, "The IPAWS change was not saved"));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const input: IpawsConfigInput = {
      environment,
      cogId: cogId.trim(),
      endpointUrl: endpointUrl.trim(),
      ...(credential ? { credential } : {}),
    };
    // The certificate and key never stay in the page once the server holds them.
    if (await run("config", () => props.client.configureIpaws(props.jurisdictionId, input))) setCredential("");
  }

  async function acknowledge(event: FormEvent) {
    event.preventDefault();
    if (await run("moa", () => props.client.acknowledgeIpawsMoa(props.jurisdictionId, moaReference.trim()))) setMoaReference("");
  }

  const canEnable = status.configured && status.moaAcknowledged;
  return (
    <section className="ipaws-config" aria-labelledby="ipaws-config-title">
      <h3 id="ipaws-config-title">IPAWS-OPEN configuration</h3>
      <form className="ipaws-form" onSubmit={(event) => void save(event)}>
        <h4>1. Collaborative Operating Group</h4>
        <label>Environment<select value={environment} onChange={(event) => setEnvironment(event.target.value as IpawsEnvironment)}>
          <option value="test">Test environment</option>
          <option value="production">Production (public alerting)</option>
        </select></label>
        <label>COG id<input value={cogId} required onChange={(event) => setCogId(event.target.value)} /></label>
        <label>IPAWS-OPEN endpoint<input type="url" value={endpointUrl} required onChange={(event) => setEndpointUrl(event.target.value)} /></label>
        <label>COG certificate and private key (PEM)<textarea
          value={credential}
          required={!status.credentialFingerprint}
          autoComplete="off"
          spellCheck={false}
          placeholder={status.credentialFingerprint
            ? "Leave blank to keep the stored certificate"
            : "-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----\n-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----"}
          onChange={(event) => setCredential(event.target.value)}
        /></label>
        <p className="notification-muted">
          The certificate FEMA issued for this COG and its unencrypted RSA key. Its CN must contain the COG id.
          It is checked, encrypted at rest and never shown again.
        </p>
        <p className="notification-muted">
          {status.credentialFingerprint
            ? `Stored certificate fingerprint ${status.credentialFingerprint}${status.certificateExpiresAt ? `, expires ${formatTime(status.certificateExpiresAt)}` : ", not a valid certificate: enter it again"}.`
            : "No certificate stored."}
        </p>
        {status.secretStorageAvailable ? null : <p role="alert" className="notification-error">This server has no secret key (OPENEOC_SECRET_KEY), so it cannot store a certificate.</p>}
        <div className="notification-actions">
          <ActionButton kind="primary" type="submit" loading={busy === "config"} loadingLabel="Saving configuration…">Save configuration</ActionButton>
        </div>
      </form>
      <form className="ipaws-form" onSubmit={(event) => void acknowledge(event)}>
        <h4>2. Memorandum of Agreement with FEMA</h4>
        {status.moaAcknowledged ? (
          <p>MOA acknowledged: {status.moaReference} · {formatTime(status.moaAcknowledgedAt)}</p>
        ) : <>
          <label>MOA reference<input value={moaReference} required disabled={!status.configured} onChange={(event) => setMoaReference(event.target.value)} /></label>
          <div className="notification-actions">
            <ActionButton type="submit" disabled={!status.configured} loading={busy === "moa"} loadingLabel="Recording…">Acknowledge MOA</ActionButton>
          </div>
          {status.configured ? null : <p className="notification-muted">Save the COG configuration first.</p>}
        </>}
      </form>
      <div className="ipaws-form">
        <h4>3. Enablement</h4>
        <p>{status.enabled
          ? "IPAWS is enabled. Alert transmissions can be requested."
          : `IPAWS is disabled. No alert transmission can be requested${status.environment === "test" ? "; a test handshake still can" : ""}.`}</p>
        <div className="notification-actions">
          <ActionButton
            kind={status.enabled ? "secondary" : "primary"}
            disabled={!status.enabled && !canEnable}
            loading={busy === "enable"}
            loadingLabel="Updating…"
            onClick={() => void run("enable", () => props.client.setIpawsEnabled(props.jurisdictionId, !status.enabled))}
          >
            {status.enabled ? "Disable IPAWS" : "Enable IPAWS"}
          </ActionButton>
        </div>
        {status.enabled || canEnable ? null : <p className="notification-muted">Enabling needs a saved configuration with a COG certificate and an acknowledged MOA.</p>}
      </div>
      {error ? <p role="alert" className="notification-error">{error}</p> : null}
    </section>
  );
}

/** The request action on a local alert record. Renders nothing for an alert outside the IPAWS profile. */
export function IpawsSendAction(props: {
  readonly client: IpawsClient;
  readonly jurisdictionId: string;
  readonly alertId: string;
  readonly ipawsEligible: boolean;
  readonly reviewState: string | null;
  readonly isAdmin: boolean;
  readonly status: IpawsStatus | null;
}) {
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState<IpawsSendRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setRequested(null); setError(null); }, [props.alertId]);
  if (!props.ipawsEligible) return null;
  const availability = sendAvailability(props);

  async function request(kind: IpawsSendKind) {
    setBusy(true);
    setError(null);
    try {
      setRequested(await props.client.requestIpawsSend(props.jurisdictionId, props.alertId, kind));
    } catch (caught) {
      setError(failure(caught, "The send could not be requested"));
    } finally {
      setBusy(false);
    }
  }

  if (requested) {
    return (
      <p role="status" className="ipaws-requested">
        {requested.kind === "handshake" ? "Test handshake requested." : "IPAWS send requested."} Nothing is sent until a
        different admin confirms it, by {new Date(requested.expiresAt).toLocaleTimeString()}.
      </p>
    );
  }
  return (
    <div className="ipaws-send-action">
      <div className="notification-actions">
        {availability.live ? <ActionButton kind="primary" loading={busy} loadingLabel="Requesting…" onClick={() => void request("live")}>Request IPAWS send</ActionButton> : null}
        {availability.handshake ? <ActionButton loading={busy} loadingLabel="Requesting…" onClick={() => void request("handshake")}>Request test handshake</ActionButton> : null}
      </div>
      {availability.reason ? <p className="notification-muted">{availability.reason}</p> : null}
      {error ? <p role="alert" className="notification-error">{error}</p> : null}
    </div>
  );
}

const SHOWN_SENDS = 10;

/** Send requests awaiting a second admin, and the outcome of recent ones. Admin only. */
export function IpawsSendsPanel(props: {
  readonly client: IpawsClient;
  readonly jurisdictionId: string;
  readonly personId: string | null;
  readonly headlines: ReadonlyMap<string, string>;
  readonly onChanged: () => void;
}) {
  const { client, jurisdictionId } = props;
  const sends = usePolled(() => client.listIpawsSends(jurisdictionId), 5000, [client, jurisdictionId]);
  const shown = (sends.data ?? []).slice(0, SHOWN_SENDS);
  const oldest = shown.at(-1)?.requestedAt ?? null;
  const version = shown.map((send) => `${send.id}:${send.status}`).join(",");
  // Names and IPAWS-OPEN answers come from the audit trail of the shown window.
  // ponytail: one chronology page (500 events); past that, names fall back to "Another admin".
  const trail = useAsync(
    () => oldest ? client.ipawsAuditTrail(jurisdictionId, new Date(Date.parse(oldest) - 1000).toISOString()) : Promise.resolve([]),
    [client, jurisdictionId, oldest, version],
  );
  const entries = trail.data ?? [];
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IpawsSendResult | null>(null);

  async function decide(send: IpawsSendRequest, decision: "confirm" | "cancel") {
    setBusy(`${decision}:${send.id}`);
    setError(null);
    setResult(null);
    try {
      if (decision === "confirm") setResult(await client.confirmIpawsSend(jurisdictionId, send.id));
      else await client.cancelIpawsSend(jurisdictionId, send.id);
      sends.reload();
      props.onChanged();
    } catch (caught) {
      setError(failure(caught, decision === "confirm" ? "The send was not confirmed" : "The request was not cancelled"));
      sends.reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="ipaws-sends" aria-labelledby="ipaws-sends-title">
      <h3 id="ipaws-sends-title">Send requests</h3>
      <p className="notification-muted">An alert leaves only when a different admin confirms the request within 15 minutes.</p>
      {sends.error ? <p role="status" className="notification-stale">Update failed. Showing the last received send requests.</p> : null}
      {result ? (
        <p role="status" className="ipaws-result" data-accepted={result.accepted}>
          IPAWS-OPEN {result.accepted ? "accepted" : "rejected"} the alert. {channelSummary(result.channels) || `Response: ${result.detail}`}
        </p>
      ) : null}
      {error ? <p role="alert" className="notification-error">{error}</p> : null}
      {sends.loading && !sends.data ? <Loading label="Loading send requests…" /> : shown.length === 0 ? <p className="notification-empty">No send requests yet.</p> : (
        <ul className="ipaws-send-list">
          {shown.map((send) => {
            const outcome = sendOutcome(send, entries, now);
            const own = send.requestedBy === props.personId;
            return (
              <li key={send.id} data-outcome={outcome.key}>
                <div className="notification-list-title">
                  <strong>{props.headlines.get(send.capAlertId) ?? "Alert record"}</strong>
                  <span className="notification-state" data-state={outcome.key}>{outcome.label}</span>
                </div>
                <dl className="notification-facts">
                  <div><dt>Kind</dt><dd>{send.kind === "handshake" ? "Test handshake" : "Alert transmission"}</dd></div>
                  <div><dt>Requested by</dt><dd>{actorName(send.requestedBy, props.personId, entries)} · {formatTime(send.requestedAt)}</dd></div>
                  {outcome.key === "pending"
                    ? <div><dt>Time left to confirm</dt><dd className="ipaws-countdown">{timeLeft(send.expiresAt, now)}</dd></div>
                    : <div><dt>Decided by</dt><dd>{send.decidedBy ? `${actorName(send.decidedBy, props.personId, entries)} · ${formatTime(send.decidedAt)}` : "No one"}</dd></div>}
                  {outcome.answer ? <div><dt>IPAWS-OPEN answer</dt><dd>{outcome.answer}</dd></div> : null}
                </dl>
                {outcome.key === "pending" ? (
                  <div className="notification-actions">
                    <ActionButton
                      kind="primary"
                      disabled={own || busy !== null}
                      loading={busy === `confirm:${send.id}`}
                      loadingLabel="Confirming…"
                      onClick={() => void decide(send, "confirm")}
                    >
                      Confirm send
                    </ActionButton>
                    <ActionButton disabled={busy !== null} loading={busy === `cancel:${send.id}`} loadingLabel="Cancelling…" onClick={() => void decide(send, "cancel")}>
                      Cancel request
                    </ActionButton>
                    {own ? <p className="notification-muted">You requested this send, so a different admin must confirm it.</p> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
