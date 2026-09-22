import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../app/api/client.js";
import { Button, StatusBadge, type Status } from "../design/components.js";
import { ConditionBadge } from "../design/feedback.js";
import {
  ContinuityCoordinator,
  type ContinuityPhase,
  type ContinuitySnapshot,
} from "./continuity.js";
import { FieldClient, type ContinuityScope } from "./field-client.js";
import { FieldSubmissionQueue } from "../field/field-submissions.js";
import { openOfflineStore, type OfflineStore } from "./store.js";
import { TaskCompletionQueue } from "./task-completions.js";
import { subscribeOfflineQueueChange } from "./queue-events.js";
import "./continuity-panel.css";

interface SyncConflictAck {
  readonly seq: number;
  readonly conflicts: number;
  readonly operationId: string | null;
  readonly exact: boolean;
}

export interface ConflictReceipt {
  /** Legacy aggregate receipt retained by older queues. */
  readonly conflicts?: number;
  readonly receipt?: SyncConflictAck;
  /** Current receipts retain the exact board and operation that require review. */
  readonly entries?: readonly {
    readonly boardId: string;
    readonly operationId: string;
    readonly conflicts: number;
    readonly receipt: SyncConflictAck;
  }[];
  readonly legacy?: {
    readonly conflicts: number;
    readonly receipt: SyncConflictAck | null;
  };
}

interface Runtime {
  readonly generation: number;
  readonly scope: ContinuityScope;
  readonly store: OfflineStore;
  readonly fields: FieldClient;
  readonly submissions: FieldSubmissionQueue;
  readonly coordinator: ContinuityCoordinator;
}

export interface ContinuityPanelProps {
  readonly client: ApiClient;
  readonly personId: string | null;
  readonly incidentId: string | null;
  readonly onRecoverSession: () => Promise<void>;
  readonly onOpenBoards: () => void;
}

export interface ContinuityStateCardProps {
  readonly snapshot: ContinuitySnapshot | null;
  readonly conflict: ConflictReceipt | null;
  readonly online: boolean;
  readonly storageError: string | null;
  readonly busy: "reconnecting" | "recovering" | null;
  readonly onReconnect: () => void;
  readonly onRecoverSession: () => void;
  readonly onOpenBoards: () => void;
}

const copy: Record<ContinuityPhase, { label: string; tone: Status; condition: "normal" | "watch" | "critical" | "stale" | "unknown"; description: string }> = {
  offline: {
    label: "Stored locally", tone: "warning", condition: "stale",
    description: "Local drafts are retained. Reconnect to confirm delivery to the server.",
  },
  queued: {
    label: "Queued locally", tone: "info", condition: "watch",
    description: "Changes are saved on this device and await server confirmation.",
  },
  reconnecting: {
    label: "Reconnecting", tone: "info", condition: "watch",
    description: "Checking the saved queue against the current server state.",
  },
  synced: {
    label: "No queued work", tone: "success", condition: "normal",
    description: "The local queue is empty. New work remains subject to normal server confirmation.",
  },
  conflict: {
    label: "Resolution required", tone: "critical", condition: "critical",
    description: "A saved submission needs review in its board before it can be treated as resolved.",
  },
  failed: {
    label: "Delivery paused", tone: "critical", condition: "critical",
    description: "Saved work remains on this device. Retry when the connection is available.",
  },
  auth_required: {
    label: "Session recovery required", tone: "critical", condition: "critical",
    description: "Saved work remains on this device. Restore your session before reconnecting.",
  },
};

function conflictKey(scope: ContinuityScope): string {
  return `field-submission-conflict:${scope.personId}:${scope.incidentId}`;
}

function conflictCount(conflict: ConflictReceipt | null): number {
  if (!conflict) return 0;
  if (conflict.entries) {
    return conflict.entries.reduce((total, entry) => total + entry.conflicts, 0)
      + (conflict.legacy?.conflicts ?? 0);
  }
  return conflict.conflicts ?? 0;
}

function snapshotPhase(snapshot: ContinuitySnapshot | null, conflict: ConflictReceipt | null): ContinuityPhase {
  if (conflictCount(conflict) > 0) return "conflict";
  return snapshot?.phase ?? "offline";
}

function queueLabel(snapshot: ContinuitySnapshot | null): string {
  if (!snapshot) return "Reading local queue…";
  const boards = snapshot.pendingBoardIds.length;
  const tasks = snapshot.pendingTaskOperationIds.length;
  if (!boards && !tasks) return "No local changes are awaiting delivery.";
  const parts = [
    boards ? `${boards} board ${boards === 1 ? "draft" : "drafts"}` : null,
    tasks ? `${tasks} task completion${tasks === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return `${parts.join(" and ")} saved locally.`;
}

/** Pure presentation for the scoped continuity result. It never claims a server receipt without one. */
export function ContinuityStateCard(props: ContinuityStateCardProps) {
  const phase = snapshotPhase(props.snapshot, props.conflict);
  const state = copy[phase];
  const conflicts = conflictCount(props.conflict) || props.snapshot?.conflicts || 0;
  const unavailable = props.storageError !== null;
  return (
    <section className="eoc-continuity" aria-label="Offline continuity">
      <header>
        <div><span>Continuity</span><h2>Local work and recovery</h2></div>
        <StatusBadge status={unavailable ? "critical" : state.tone}>{unavailable ? "Local storage unavailable" : state.label}</StatusBadge>
      </header>
      {unavailable ? <p role="alert">{props.storageError}</p> : <>
        <div className="eoc-continuity-state">
          <ConditionBadge state={!props.online && phase !== "conflict" ? "stale" : state.condition} label={!props.online && phase !== "conflict" ? "Offline" : state.label} />
          <p>{!props.online ? "Network unavailable. Local drafts and queued work remain on this device." : state.description}</p>
        </div>
        <dl>
          <div><dt>Saved locally</dt><dd>{queueLabel(props.snapshot)}</dd></div>
          <div><dt>Server receipt</dt><dd>{phase === "synced" ? "No queued work remains." : phase === "conflict" ? "A receipt reported a conflict." : "Pending confirmation."}</dd></div>
          {conflicts ? <div><dt>Conflicts</dt><dd>{conflicts} submission{conflicts === 1 ? "" : "s"} require review.</dd></div> : null}
          {props.snapshot?.lastError ? <div><dt>Latest delivery issue</dt><dd>{props.snapshot.lastError}</dd></div> : null}
        </dl>
        <div className="eoc-continuity-actions">
          {phase === "auth_required" ? <Button kind="primary" disabled={props.busy !== null} onClick={props.onRecoverSession}>{props.busy === "recovering" ? "Restoring session…" : "Restore session"}</Button> : null}
          {phase === "conflict" ? <Button kind="primary" onClick={props.onOpenBoards}>Open boards to resolve</Button> : null}
          {phase !== "conflict" && phase !== "auth_required" ? <Button kind="quiet" disabled={!props.online || props.busy !== null} onClick={props.onReconnect}>{props.busy === "reconnecting" ? "Reconnecting…" : "Reconnect and reconcile"}</Button> : null}
        </div>
      </>}
    </section>
  );
}

/** Shell-level adapter over the existing scoped offline engines. */
export function ContinuityPanel(props: ContinuityPanelProps) {
  const scope = useMemo<ContinuityScope | null>(() => props.personId && props.incidentId
    ? { personId: props.personId, incidentId: props.incidentId }
    : null, [props.incidentId, props.personId]);
  const runtime = useRef<Runtime | null>(null);
  const generation = useRef(0);
  const refreshSequence = useRef(0);
  const [snapshot, setSnapshot] = useState<ContinuitySnapshot | null>(null);
  const [conflict, setConflict] = useState<ConflictReceipt | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [busy, setBusy] = useState<"reconnecting" | "recovering" | null>(null);

  const current = useCallback((candidate: Runtime) => runtime.current === candidate, []);

  const refresh = useCallback(async (candidate: Runtime) => {
    const sequence = refreshSequence.current + 1;
    refreshSequence.current = sequence;
    const [next, storedConflict] = await Promise.all([
      candidate.coordinator.snapshot(candidate.scope),
      candidate.store.getMeta<ConflictReceipt>(conflictKey(candidate.scope)),
    ]);
    if (!current(candidate) || sequence !== refreshSequence.current) return;
    setSnapshot(next);
    setConflict(storedConflict);
  }, [current]);

  useEffect(() => {
    const prior = runtime.current;
    runtime.current = null;
    prior?.store.close();
    setSnapshot(null); setConflict(null); setStorageError(null);
    setBusy(null);
    setOnline(typeof navigator === "undefined" || navigator.onLine);
    if (!scope) return;
    const nextGeneration = generation.current + 1;
    generation.current = nextGeneration;
    let active = true;
    let removeListeners = () => {};
    void openOfflineStore().then(async (store) => {
      if (!active) { store.close(); return; }
      const fields = new FieldClient(store);
      const submissions = FieldSubmissionQueue.from(store, fields);
      const coordinator = new ContinuityCoordinator(store, fields, new TaskCompletionQueue(store));
      const candidate = { generation: nextGeneration, scope, store, fields, submissions, coordinator };
      runtime.current = candidate;
      try {
        await refresh(candidate);
      } catch (reason) {
        if (active && current(candidate)) setStorageError(reason instanceof Error ? reason.message : "Local continuity storage is unavailable.");
      }
      if (!active || !current(candidate)) return;
      const removeQueueListener = subscribeOfflineQueueChange(scope, () => {
        if (current(candidate)) void refresh(candidate);
      });
      const offline = () => {
        if (!current(candidate)) return;
        setOnline(false);
        void coordinator.markOffline(scope).then(() => refresh(candidate)).catch(() => undefined);
      };
      const connected = () => {
        if (!current(candidate)) return;
        setOnline(true); void refresh(candidate);
      };
      addEventListener("offline", offline); addEventListener("online", connected);
      removeListeners = () => {
        removeQueueListener();
        removeEventListener("offline", offline);
        removeEventListener("online", connected);
      };
    }).catch((reason: unknown) => {
      if (active) setStorageError(reason instanceof Error ? reason.message : "Local continuity storage is unavailable.");
    });
    return () => {
      active = false;
      removeListeners();
      const candidate = runtime.current;
      if (candidate?.generation === nextGeneration) {
        candidate.store.close();
        runtime.current = null;
      }
    };
  }, [current, refresh, scope]);

  const reconnect = useCallback(async () => {
    const candidate = runtime.current;
    if (!scope || !candidate || candidate.scope !== scope) return;
    setBusy("reconnecting");
    setSnapshot((current) => current ? { ...current, phase: "reconnecting", lastError: null } : current);
    try {
      await candidate.coordinator.reconnect(scope, {
        // Resolve the transient bearer inside the coordinator-controlled
        // adapter. If background traffic already cleared an expired session,
        // the coordinator must still persist `auth_required` for recovery.
        syncBoard: (boardId) => candidate.submissions.syncOne(
          scope, boardId, props.client.fieldSyncToken()),
        completeTask: (operation) => props.client.completeIncidentTask(
          operation.incidentId, operation.taskId, operation.operationId),
      });
    } catch {
      // The coordinator stores the normalized outcome and retains unsent work.
    } finally {
      await refresh(candidate).catch(() => undefined);
      if (current(candidate)) setBusy(null);
    }
  }, [current, props.client, refresh, scope]);

  const recoverSession = useCallback(async () => {
    setBusy("recovering");
    try {
      await props.onRecoverSession();
      await reconnect();
    } catch {
      // SessionProvider has cleared the invalid session and routes to sign-in.
      // The scope-owned queue is intentionally left untouched in IndexedDB.
    } finally { setBusy(null); }
  }, [props.onRecoverSession, reconnect]);

  if (!scope) return null;
  return <ContinuityStateCard snapshot={snapshot} conflict={conflict} online={online}
    storageError={storageError} busy={busy} onReconnect={() => void reconnect()}
    onRecoverSession={() => void recoverSession()} onOpenBoards={props.onOpenBoards} />;
}
