import { useEffect, useMemo, useState, type FormEvent } from "react";
import { runForm, type AnswerRecord } from "@openeoc/shared";
import { FieldCaptureFields, formBoardData } from "../../field/FieldCapture.js";
import {
  FieldSubmissionQueue,
  type FieldSubmissionState,
} from "../../field/field-submissions.js";
import { ActionButton } from "../../design/controls.js";
import { EmptyState, ErrorState, LoadingState } from "../../design/feedback.js";
import { Icon } from "../../design/icons/Icon.js";
import type { ApiClient } from "../api/client.js";
import { useSession } from "../auth/session.js";
import { useAsync } from "../data/hooks.js";
import { uploadPickedFile } from "../data/files.js";
import { Scroll, SurfaceHeader } from "../screens/parts.js";
import "../../field/field-workspace.css";

const INITIAL_QUEUE: FieldSubmissionState = {
  phase: "ready",
  pending: 0,
  receipt: null,
  message: "Preparing durable field storage…",
};

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

export interface SmartFormsSurfaceProps {
  readonly client: ApiClient;
  readonly jurisdictionId: string;
  readonly incidentId: string | null;
  readonly onOpenMap?: () => void;
}

/** Touch-first XLSForm capture backed by the exact incident-scoped board queue. */
export function SmartFormsSurface(props: SmartFormsSurfaceProps) {
  const session = useSession();
  const personId = session.me?.person.id ?? null;
  const online = useOnline();
  const forms = useAsync(() => props.client.listForms(props.jurisdictionId), [props.client, props.jurisdictionId]);
  const boards = useAsync(async () => {
    const incidentId = props.incidentId;
    if (!incidentId) return [];
    const refs = await props.client.incidentBoards(incidentId);
    return Promise.all(refs.map((board) => props.client.getBoard(board.id, incidentId)));
  }, [props.client, props.incidentId]);
  const [formKey, setFormKey] = useState("");
  const [boardId, setBoardId] = useState("");
  const [answers, setAnswers] = useState<AnswerRecord>({});
  const [queue, setQueue] = useState<FieldSubmissionQueue | null>(null);
  const [queueState, setQueueState] = useState<FieldSubmissionState>(INITIAL_QUEUE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const formList = forms.data ?? [];
  const activeKey = formKey || formList[0]?.key || "";
  const definition = useAsync(
    () => activeKey ? props.client.getForm(props.jurisdictionId, activeKey) : Promise.resolve(null),
    [activeKey, props.client, props.jurisdictionId],
  );
  const targetBoards = useMemo(() => (boards.data ?? []).filter((board) =>
    !definition.data?.boardTemplate || board.templateKey === definition.data.boardTemplate),
  [boards.data, definition.data?.boardTemplate]);
  const activeBoardId = boardId || targetBoards[0]?.id || "";
  const activeBoard = targetBoards.find((board) => board.id === activeBoardId) ?? null;
  const hasDraft = Object.values(answers).some((value) => value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0));
  const scope = personId && props.incidentId ? { personId, incidentId: props.incidentId } : null;

  useEffect(() => {
    setFormKey("");
    setBoardId("");
    setAnswers({});
    setError(null);
    setMessage(null);
  }, [props.incidentId]);

  useEffect(() => {
    const incidentId = props.incidentId;
    if (!personId || !incidentId) return;
    const currentScope = { personId, incidentId };
    let current = true;
    let opened: FieldSubmissionQueue | null = null;
    void FieldSubmissionQueue.open().then(async (value) => {
      opened = value;
      if (!current) return value.close();
      setQueue(value);
      setQueueState(await value.state(currentScope));
    }).catch((reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message : "Durable field storage is unavailable.");
    });
    return () => {
      current = false;
      opened?.close();
      setQueue(null);
    };
  }, [props.incidentId, personId]);

  const synchronize = async (adapter: FieldSubmissionQueue, currentScope: NonNullable<typeof scope>) => {
    setQueueState((current) => ({ ...current, phase: "syncing", message: "Synchronizing queued field submissions…" }));
    try {
      const result = await adapter.sync(currentScope, props.client.fieldSyncToken());
      setQueueState(result);
      return result;
    } catch (reason) {
      const result: FieldSubmissionState = {
        phase: "auth_required",
        pending: (await adapter.state(currentScope)).pending,
        receipt: null,
        message: reason instanceof Error ? reason.message : "Sign in again to synchronize.",
      };
      setQueueState(result);
      return result;
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null); setMessage(null);
    if (!definition.data || !activeBoard || !queue || !scope) {
      setError("Choose an incident form and board, then wait for durable storage.");
      return;
    }
    const run = runForm(definition.data, answers);
    if (run.errors.length > 0) {
      setError("Complete the required field values before queueing this report.");
      return;
    }
    setBusy(true);
    try {
      const recordId = crypto.randomUUID();
      const queued = await queue.enqueue(
        scope,
        activeBoard.id,
        recordId,
        formBoardData(definition.data, activeBoard.fields, answers),
      );
      setQueueState(queued);
      setAnswers({});
      setMessage(`Report ${recordId.slice(0, 8)} is durably queued on this device.`);
      if (online) {
        const synchronized = await synchronize(queue, scope);
        if (synchronized.phase === "synced") setMessage("Report synchronized with retained server attribution.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The report could not be queued.");
    } finally {
      setBusy(false);
    }
  };

  if (!props.incidentId) return <EmptyState title="Select an incident" description="Field submissions are scoped to one incident, person and attached board." />;
  if ((forms.loading && !forms.data) || (boards.loading && !boards.data)) return <LoadingState label="Loading field forms…" />;
  if ((forms.error && !forms.data) || (boards.error && !boards.data)) return <ErrorState title="Field forms unavailable" message={forms.error ?? boards.error ?? "Field forms are unavailable."} />;
  if (formList.length === 0) return <EmptyState title="No field forms available" description="An administrator must import an XLSForm before field capture can begin." />;

  return <Scroll>
    <SurfaceHeader title="Smart Forms" />
    <section className="eoc-field-workspace" aria-label="Field report capture">
      <section className="eoc-field-hero">
        <div><span className="eoc-field-eyebrow">Touch field capture</span><h1>Record once, synchronize with attribution</h1>
          <p>Reports are stored for this person, incident and board before the first synchronization attempt.</p></div>
        <div className={`eoc-field-sync eoc-field-sync--${queueState.phase}`} role="status" aria-live="polite">
          <Icon name="fieldReports" decorative size={20} />
          <div><strong>{queueState.phase.replace("_", " ")}</strong><span>{queueState.message}</span></div>
          {queueState.pending > 0 ? <ActionButton kind="secondary" disabled={busy || !online || !queue || !scope}
            onClick={() => { if (queue && scope) void synchronize(queue, scope); }}>Sync {queueState.pending} queued</ActionButton> : null}
        </div>
      </section>

      <section className="eoc-field-selector" aria-labelledby="field-assignment-title">
        <header><Icon name="smartForms" decorative size={24} /><div><span className="eoc-field-eyebrow">Form library</span><h2 id="field-assignment-title">Choose a capture form</h2><p>Your organization&apos;s forms are submitted to the selected incident board.</p></div></header>
        <div className="eoc-field-selector-grid">
          <label>Your organization&apos;s form<select value={activeKey} onChange={(event) => {
            setFormKey(event.target.value); setBoardId(""); setAnswers({}); setError(null);
          }}>{formList.map((form) => <option key={form.key} value={form.key}>{form.title}</option>)}</select></label>
          <label>Incident board<select value={activeBoardId} onChange={(event) => { setBoardId(event.target.value); setAnswers({}); }}>
            {targetBoards.map((board) => <option key={board.id} value={board.id}>{board.title}</option>)}</select></label>
        </div>
        {targetBoards.length === 0 ? <p role="alert">This incident has no attached board matching the selected form.</p> : null}
        {props.onOpenMap ? <div className="eoc-field-map-link"><div><strong>Need map placement?</strong><span>{!online ? "Map record submission requires a connection." : hasDraft ? "Queue or clear these answers before leaving this form." : "The COP map uses its existing validated point-capture workflow."}</span></div>
          <ActionButton kind="quiet" disabled={!online || hasDraft} onClick={props.onOpenMap}><Icon name="map" decorative size={16} /> Open map capture</ActionButton></div> : null}
      </section>

      <section className="eoc-field-form" aria-labelledby="field-form-title">
        <header><div><span className="eoc-field-eyebrow">{online ? "Connected" : "Offline capture"}</span><h2 id="field-form-title">{definition.data?.title ?? "Questions"}</h2></div>
          <span>{definition.data ? `Version ${definition.data.version}` : "Loading"}</span></header>
        {definition.loading && !definition.data ? <LoadingState label="Loading questions…" /> : null}
        {definition.data ? <form aria-label="Field report form" onSubmit={(event) => void submit(event)}>
          <FieldCaptureFields definition={definition.data} answers={answers} online={online}
            onChange={setAnswers} onUpload={(file) => uploadPickedFile(props.client, props.jurisdictionId, file)} />
          <div className="eoc-field-submit"><div><strong>Durable board queue</strong><span>Attachments require a connection. Report fields can queue after this form is loaded.</span></div>
            <ActionButton kind="primary" type="submit" loading={busy} loadingLabel="Queueing report…" disabled={!activeBoard}>Queue field report</ActionButton></div>
        </form> : null}
        {message ? <p className="eoc-field-success" role="status">{message}</p> : null}
        {error ? <p className="eoc-field-error" role="alert">{error}</p> : null}
      </section>
    </section>
  </Scroll>;
}
