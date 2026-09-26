import { useId, useState } from "react";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../design/components.js";
import { Icon } from "../design/icons/index.js";
import "../datasets/datasets.css";
import "./federation.css";
import type { ApiClient, BoardListItem } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { EmptyState, ErrorNote, Loading, Scroll, SurfaceHeader } from "../app/screens/parts.js";
import { formatTime } from "../datasets/format.js";
import { accessLabel, linkLabel, waitedFor, type InstanceIdentity, type PeerStatus, type SharedBoardStatus } from "./model.js";

type Run = (operation: () => Promise<string>) => Promise<void>;

const ACCESS = ["read", "write"] as const;
const ACCESS_LABELS = { read: "Partner reads this board", write: "Partner reads and writes this board" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Federation with partner instances: hand this instance's public key to
 * partners, register a partner and hand over its token once, record its
 * public key, link it for push delivery, share boards with it or revoke a
 * share, and watch the outbox and what partners have sent. Administrators
 * only; the server refuses these routes to anyone else regardless.
 */
export function FederationSurface(props: {
  client: ApiClient;
  jurisdictionId: string;
  isAdmin: boolean;
  boards: readonly BoardListItem[];
}) {
  if (!props.isAdmin) {
    return <EmptyState label="Federation is available to administrators."
      hint="Ask a jurisdiction administrator about partner instances and shared boards." />;
  }
  return <Federation {...props} />;
}

function Federation(props: { client: ApiClient; jurisdictionId: string; boards: readonly BoardListItem[] }) {
  const status = useAsync(() => props.client.federationStatus(props.jurisdictionId), [props.jurisdictionId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState("");

  const run: Run = async (operation) => {
    setBusy(true); setError(null); setNotice("");
    try { setNotice(await operation()); status.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The change could not be saved."); }
    finally { setBusy(false); }
  };
  const copy = (token: string) => {
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(token))
      .then(() => setCopied("Token copied."), () => setCopied("Copy failed. Select the token and copy it by hand."));
  };
  const identity = status.data?.identity;

  return (
    <Scroll>
      <SurfaceHeader title="Federation" actions={<Button onClick={status.reload} disabled={status.loading}>Refresh status</Button>} />
      <div className="d21-workspace">
        <div className="d21-workspace-intro">
          <Icon name="participants" size={32} decorative />
          <div>
            <strong>Partner instances and shared boards</strong>
            <span>A partner is another Open Source EOC instance, such as a neighboring county or the state. Updates to a shared board wait in an outbox and are pushed whenever the partner is reachable, so a partition loses nothing.</span>
          </div>
        </div>
        {error ? <p className="d21-error" role="alert">{error}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}

        <Panel title="This instance's key">
          {status.data && identity ? <InstanceKey identity={identity} /> : null}
          {status.data && !identity ? (
            <p className="d21-callout">This instance has no key yet. The server needs OPENEOC_SECRET_KEY set to keep its private key, and partners refuse batches until they record this instance's public key.</p>
          ) : null}
        </Panel>

        <Panel title="Register a partner">
          <fieldset disabled={busy} className="eoc-fieldset eoc-stack">
            <TextField label="Partner name" value={name} onChange={setName} required />
            <div className="d21-toolbar">
              <span className="d21-muted">Registering issues the token the partner presents when it delivers to this instance.</span>
              <Button kind="primary" onClick={() => void run(async () => {
                const partner = name.trim();
                if (!partner) throw new Error("Enter the partner's name.");
                const result = await props.client.registerPeer(props.jurisdictionId, partner);
                setIssued({ name: partner, token: result.token });
                setCopied("");
                setName("");
                return `${partner} registered.`;
              })}>Register partner</Button>
            </div>
          </fieldset>
          {issued ? (
            <section className="d21-token federation-token" aria-label="New partner token">
              <strong>Token for {issued.name}, shown once</strong>
              <p className="d21-callout">Copy this token now. It cannot be shown again: only its hash is stored. Give it to the {issued.name} administrator, who enters it as the push link token on their instance.</p>
              <code>{issued.token}</code>
              <div className="d21-card-actions is-start">
                <Button onClick={() => copy(issued.token)}>Copy token</Button>
                <Button kind="primary" onClick={() => { setIssued(null); setCopied(""); }}>I have saved the token</Button>
                {copied ? <span role="status">{copied}</span> : null}
              </div>
            </section>
          ) : null}
        </Panel>

        <Panel title="Partners">
          {status.error && !status.data ? <ErrorNote message={status.error} /> : null}
          {!status.data && !status.error ? <Loading label="Loading partners…" /> : null}
          {status.data?.peers.length === 0 ? <p className="d21-muted">No partners registered yet.</p> : null}
          <ul className="d21-readiness-list is-single">
            {(status.data?.peers ?? []).map((peer) => (
              <PeerCard key={peer.id} peer={peer} client={props.client} boards={props.boards} busy={busy} run={run} />
            ))}
          </ul>
        </Panel>

        <Panel title="Received from partners">
          {status.data?.received.length === 0 ? <p className="d21-muted">Nothing received yet. Batches a partner pushes to this instance appear here.</p> : null}
          <ul className="d21-readiness-list is-single">
            {(status.data?.received ?? []).map((batch) => (
              <li key={`${batch.at}-${batch.boardId}`} className="d21-readiness-row" aria-label={`Received from ${batch.peer}`}>
                <div className="d21-readiness-title">
                  <div><strong>{batch.boardTitle ?? "A board no longer listed"}</strong><span>From {batch.peer} · {formatTime(batch.at)}</span></div>
                </div>
                <span>{batch.updates === 1 ? "1 update" : `${batch.updates} updates`}{batch.deletes ? `, ${batch.deletes} deleted` : ""}{batch.conflicts ? `, ${batch.conflicts} conflicts reconciled` : ""}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Resource escalation">
          <p className="d21-muted">Resource escalation keeps no stored targets. Whoever escalates a request supplies the higher tier's name, address and peer token with that escalation; it is sent once, directly, and recorded on the request's chronology. It does not use the partner links on this screen.</p>
        </Panel>
      </div>
    </Scroll>
  );
}

function PeerCard(props: { peer: PeerStatus; client: ApiClient; boards: readonly BoardListItem[]; busy: boolean; run: Run }) {
  const { peer } = props;
  const linked = Boolean(peer.endpointUrl && peer.tokenStored);
  const waiting = peer.boards.reduce((sum, board) => sum + board.pending, 0);
  const shared = new Set(peer.boards.map((board) => board.boardId));
  const options = props.boards.filter((board) => !shared.has(board.id));
  const [endpointUrl, setEndpointUrl] = useState("");
  const [token, setToken] = useState("");
  const [boardId, setBoardId] = useState("");
  const [access, setAccess] = useState<string>("read");
  const [remoteBoardId, setRemoteBoardId] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const keyField = useId();
  const chosen = options.some((board) => board.id === boardId) ? boardId : (options[0]?.id ?? "");

  return (
    <li className="d21-readiness-row" aria-label={`Partner ${peer.name}`}>
      <div className="d21-readiness-title">
        <div><strong>{peer.name}</strong><span>{linkLabel(peer)}</span></div>
      </div>
      <span className="d21-readiness-badge">
        <StatusBadge status={!linked ? "unknown" : waiting ? "warning" : "success"}>
          {!linked ? "Not linked" : waiting ? `${waiting} waiting` : "Up to date"}
        </StatusBadge>
      </span>
      <dl className="d21-metrics">
        <div><dt>Registered</dt><dd>{formatTime(peer.createdAt)}</dd></div>
        <div><dt>Shared boards</dt><dd>{peer.boards.length}</dd></div>
        <div><dt>Waiting to send</dt><dd>{waiting}</dd></div>
        <div><dt>Partner key</dt><dd>{peer.keyFingerprint ? "Recorded" : "Not recorded"}</dd></div>
      </dl>
      {peer.keyFingerprint ? null : (
        <p className="d21-callout federation-wide">Batches from {peer.name} are refused until its public key is recorded under Set partner key.</p>
      )}
      <ul className="d21-card-grid federation-wide">
        {peer.boards.map((board) => (
          <SharedBoard key={board.id} board={board} peer={peer} linked={linked} client={props.client} busy={props.busy} run={props.run} />
        ))}
      </ul>
      <fieldset disabled={props.busy} className="federation-link">
        <details>
          <summary>Set partner key</summary>
          <p className="eoc-input-field federation-fields">
            <label htmlFor={keyField}>Partner's public key</label>
            <textarea id={keyField} className="eoc-input" rows={4} value={publicKey}
              placeholder="-----BEGIN PUBLIC KEY-----" onChange={(event) => setPublicKey(event.target.value)} />
          </p>
          <div className="d21-toolbar">
            <span className="d21-muted">
              {peer.keyFingerprint
                ? <>Recorded key fingerprint <code className="federation-fingerprint">{peer.keyFingerprint}</code>. Saving replaces it.</>
                : `Paste the public key shown on ${peer.name}'s Federation screen and compare its fingerprint with theirs.`}
            </span>
            <Button onClick={() => void props.run(async () => {
              if (!publicKey.trim()) throw new Error("Paste the partner's public key.");
              const result = await props.client.setPeerKey(peer.id, publicKey);
              setPublicKey("");
              return `Key recorded for ${peer.name}, fingerprint ${result.fingerprint}.`;
            })}>Save partner key</Button>
          </div>
        </details>
        <details>
          <summary>Set push link</summary>
          <div className="d21-form-grid federation-fields">
            <TextField label="Partner address" value={endpointUrl} onChange={setEndpointUrl} required />
            <TextField label="Token issued by the partner" type="password" value={token} onChange={setToken} required />
          </div>
          <div className="d21-toolbar">
            <span className="d21-muted">{peer.tokenStored ? "A token is stored and is never shown. Saving replaces the address and the token." : "The token is stored encrypted and is never shown again."}</span>
            <Button onClick={() => void props.run(async () => {
              if (!endpointUrl.trim() || !token) throw new Error("Enter the partner's address and the token it issued.");
              await props.client.setPeerLink(peer.id, endpointUrl.trim(), token);
              setEndpointUrl(""); setToken("");
              return `Push link saved for ${peer.name}.`;
            })}>Save push link</Button>
          </div>
        </details>
        <details>
          <summary>Share a board</summary>
          {options.length === 0 ? <p className="d21-muted">Every board in this jurisdiction is already shared with {peer.name}.</p> : <>
            <div className="d21-form-grid federation-fields">
              <EnumSelect label="Board" values={options.map((board) => board.id)}
                labels={Object.fromEntries(options.map((board) => [board.id, board.title]))}
                value={chosen} onChange={setBoardId} />
              <EnumSelect label="Partner access" values={ACCESS} labels={ACCESS_LABELS} value={access} onChange={setAccess} />
              <div className="d21-form-grid-wide">
                <TextField label="Receiving board ID on the partner" value={remoteBoardId} onChange={setRemoteBoardId} />
              </div>
            </div>
            <div className="d21-toolbar">
              <span className="d21-muted">Updates are pushed to the receiving board. Without one they wait in the outbox.</span>
              <Button onClick={() => void props.run(async () => {
                const remote = remoteBoardId.trim();
                if (remote && !UUID.test(remote)) throw new Error("Enter the receiving board ID exactly as the partner's board shows it, or leave it empty.");
                const title = options.find((board) => board.id === chosen)?.title ?? "The board";
                await props.client.createSharingAgreement(peer.id, {
                  boardId: chosen, canRead: true, canWrite: access === "write", ...(remote ? { remoteBoardId: remote } : {}),
                });
                setRemoteBoardId("");
                return `${title} shared with ${peer.name}.`;
              })}>Share board</Button>
            </div>
          </>}
        </details>
      </fieldset>
    </li>
  );
}

function InstanceKey(props: { identity: InstanceIdentity }) {
  const [copied, setCopied] = useState("");
  const copy = () => {
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(props.identity.publicKey))
      .then(() => setCopied("Public key copied."), () => setCopied("Copy failed. Select the key and copy it by hand."));
  };
  return (
    <div className="eoc-stack">
      <p className="d21-muted">Give this public key to each partner's administrator, who records it on this instance's card on their Federation screen. Compare fingerprints with them first. A partner applies this instance's batches only when they verify under this key.</p>
      <p>Fingerprint <code className="federation-fingerprint">{props.identity.fingerprint}</code></p>
      <pre className="federation-key" aria-label="This instance's public key">{props.identity.publicKey.trim()}</pre>
      <div className="d21-card-actions is-start">
        <Button onClick={copy}>Copy public key</Button>
        {copied ? <span role="status">{copied}</span> : null}
      </div>
    </div>
  );
}

function SharedBoard(props: { board: SharedBoardStatus; peer: PeerStatus; linked: boolean; client: ApiClient; busy: boolean; run: Run }) {
  const { board, peer } = props;
  const [confirming, setConfirming] = useState(false);
  const next = board.pending === 0 ? "Nothing waiting"
    : !props.linked ? "Held until the partner is linked"
      : !board.remoteBoardId ? "Held until a receiving board is set"
        : board.nextAttemptAt ? formatTime(board.nextAttemptAt) : "Next pass";
  return (
    <li className="d21-card" aria-label={`${board.boardTitle} shared with ${peer.name}`}>
      <div className="d21-card-header">
        <div><strong>{board.boardTitle}</strong><span>{accessLabel(board)}</span></div>
      </div>
      <dl className="d21-facts">
        <div><dt>Receiving board</dt><dd>{board.remoteBoardId ?? "Not set"}</dd></div>
        <div><dt>Waiting</dt><dd>{board.pending}</dd></div>
        <div><dt>Oldest waiting</dt><dd>{board.oldestPendingAt ? waitedFor(board.oldestPendingAt) : "None"}</dd></div>
        <div><dt>Next attempt</dt><dd>{next}</dd></div>
        <div><dt>Last delivered</dt><dd>{board.lastDeliveredAt ? formatTime(board.lastDeliveredAt) : "Never"}</dd></div>
        <div><dt>Last error</dt><dd>{board.lastError ?? "None"}</dd></div>
      </dl>
      {confirming ? (
        <div className="d21-toolbar" role="group" aria-label="Confirm revoke">
          <span>Revoke sharing {board.boardTitle} with {peer.name}? Nothing more is sent to {peer.name} or accepted from it for this board{board.pending ? `, and the ${board.pending} waiting ${board.pending === 1 ? "update is" : "updates are"} dropped` : ""}.</span>
          <div className="d21-card-actions">
            <Button onClick={() => setConfirming(false)}>Keep sharing</Button>
            <Button kind="danger" disabled={props.busy} onClick={() => void props.run(async () => {
              await props.client.revokeSharingAgreement(peer.id, board.id);
              return `${board.boardTitle} is no longer shared with ${peer.name}.`;
            })}>Revoke agreement</Button>
          </div>
        </div>
      ) : (
        <div className="d21-card-actions is-start">
          <Button kind="danger" disabled={props.busy} onClick={() => setConfirming(true)}>Revoke sharing</Button>
        </div>
      )}
    </li>
  );
}
