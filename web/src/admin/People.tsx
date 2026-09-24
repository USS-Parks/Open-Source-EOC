import { useState } from "react";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../design/components.js";
import {
  OperationalTable,
  createOperationalTableViewState,
  type OperationalTableColumn,
  type OperationalTableViewState,
} from "../design/table.js";
import type { AdminMember, ApiClient, MemberRole, MembersPage } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ROLE_LABELS } from "./labels.js";
import "./admin.css";

const ROLES = ["admin", "member", "viewer"] as const;

/**
 * People of one jurisdiction: create an account or add an existing one, and
 * for each person change the role, disable or enable sign-in, reset the
 * second factor, or remove the membership. The server decides every change;
 * this screen reports its answer.
 */
export function People(props: { client: ApiClient; jurisdictionId: string; actorId: string }) {
  const first = useAsync(() => props.client.listMembers(props.jurisdictionId), [props.jurisdictionId]);
  // Pages added with "Load more" extend the first page they were read after.
  const [more, setMore] = useState<{ base: MembersPage; members: readonly AdminMember[]; nextCursor: string | null } | null>(null);
  const loaded = first.data && more?.base === first.data ? more
    : first.data ? { base: first.data, members: first.data.members, nextCursor: first.data.nextCursor } : null;
  const nextCursor = loaded?.nextCursor ?? null;
  const loadMore = loaded && nextCursor ? async () => {
    const next = await props.client.listMembers(props.jurisdictionId, { cursor: nextCursor });
    setMore({ base: loaded.base, members: [...loaded.members, ...next.members], nextCursor: next.nextCursor });
  } : undefined;
  const members = loaded?.members ?? [];

  const [tableState, setTableState] = useState<OperationalTableViewState>(() => createOperationalTableViewState(
    COLUMN_WIDTHS, { pageSize: 25 },
  ));
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = members.find((m) => m.personId === selectedId) ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const run = async (operation: () => Promise<string>) => {
    setBusy(true); setError(null); setNotice("");
    try { setNotice(await operation()); first.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The change could not be saved."); }
    finally { setBusy(false); }
  };

  const columns: readonly OperationalTableColumn<AdminMember>[] = [
    { id: "name", header: "Name", value: (m) => m.displayName,
      render: (m) => <Button onClick={() => { setSelectedId(m.personId); setNotice(""); setError(null); }}>{m.displayName}</Button> },
    { id: "email", header: "Email", value: (m) => m.email },
    { id: "role", header: "Role", value: (m) => ROLE_LABELS[m.role] },
    { id: "signin", header: "Sign-in", value: (m) => (m.disabled ? "Disabled" : "Active"),
      render: (m) => <StatusBadge status={m.disabled ? "critical" : "success"}>{m.disabled ? "Disabled" : "Active"}</StatusBadge> },
    { id: "mfa", header: "Two-step sign-in", value: (m) => (m.mfaEnrolled ? "Enrolled" : "Not enrolled") },
  ];
  const start = tableState.page * tableState.pageSize;
  const rows = members.slice(start, start + tableState.pageSize);

  return (
    <div className="admin-tab">
      {error ? <p className="d21-error" role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <OperationalTable
        tableId="admin-people"
        caption={loaded ? `People of ${loaded.base.jurisdiction.name}` : "People"}
        columns={columns}
        rows={rows}
        rowId={(m) => m.personId}
        datasetKey={props.jurisdictionId}
        status={first.error && !loaded ? "error" : !loaded ? "loading" : members.length === 0 ? "empty" : "ready"}
        errorMessage={first.error ?? "People could not be loaded."}
        onRetry={first.reload}
        emptyTitle="No people yet"
        emptyDescription="Create an account or add an existing one below."
        viewState={tableState}
        onViewStateChange={setTableState}
        totalRows={nextCursor ? null : members.length}
        hasPreviousPage={tableState.page > 0}
        hasNextPage={start + tableState.pageSize < members.length}
        selectedIds={checked}
        onSelectionChange={setChecked}
        toolbar={<span className="d21-muted">Select a name to change that person's role, sign-in or two-step sign-in.</span>}
        {...(loadMore ? { onLoadMore: loadMore } : {})}
      />
      {selected ? <PersonDetail key={selected.personId} member={selected} self={selected.personId === props.actorId}
        busy={busy} onClose={() => setSelectedId(null)}
        onRole={(role) => run(async () => {
          await props.client.setMemberRole(props.jurisdictionId, selected.personId, role);
          return `${selected.displayName} is now ${ROLE_LABELS[role].toLowerCase()}.`;
        })}
        onDisabled={(disabled) => run(async () => {
          await props.client.setMemberDisabled(props.jurisdictionId, selected.personId, disabled);
          return disabled ? `${selected.displayName} can no longer sign in.` : `${selected.displayName} can sign in again.`;
        })}
        onResetMfa={(reason) => run(async () => {
          await props.client.resetMemberMfa(props.jurisdictionId, selected.personId, reason);
          return `Two-step sign-in reset for ${selected.displayName}. They enroll again at their next sign-in.`;
        })}
        onRemove={() => run(async () => {
          await props.client.removeMember(props.jurisdictionId, selected.personId);
          setSelectedId(null);
          return `${selected.displayName} was removed from this jurisdiction.`;
        })} /> : null}
      <AddPerson client={props.client} jurisdictionId={props.jurisdictionId} busy={busy} run={run} />
    </div>
  );
}

const COLUMN_WIDTHS = [
  { id: "name", width: 190 }, { id: "email", width: 220 }, { id: "role", width: 130 },
  { id: "signin", width: 110 }, { id: "mfa", width: 150 },
];

function PersonDetail(props: {
  member: AdminMember; self: boolean; busy: boolean; onClose: () => void;
  onRole: (role: MemberRole) => void; onDisabled: (disabled: boolean) => void;
  onResetMfa: (reason: string) => void; onRemove: () => void;
}) {
  const m = props.member;
  const [role, setRole] = useState<MemberRole>(m.role);
  const [reason, setReason] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <Panel title={m.displayName}>
      <fieldset disabled={props.busy} className="eoc-fieldset eoc-stack">
        <dl className="d21-facts">
          <div><dt>Email</dt><dd>{m.email}</dd></div>
          <div><dt>Role</dt><dd>{ROLE_LABELS[m.role]}{m.instanceAdmin ? " · instance administrator" : ""}</dd></div>
          <div><dt>Sign-in</dt><dd>{m.disabled ? "Disabled" : "Active"}</dd></div>
          <div><dt>Two-step sign-in</dt><dd>{m.mfaEnrolled ? "Enrolled" : "Not enrolled"}</dd></div>
        </dl>
        <div className="d21-form-grid">
          <EnumSelect label={`Role for ${m.displayName}`} values={ROLES} labels={ROLE_LABELS} value={role}
            onChange={(value) => setRole(value as MemberRole)} />
          <div className="admin-end">
            <Button kind="primary" onClick={() => props.onRole(role)} disabled={role === m.role}>Save role</Button>
          </div>
        </div>
        {props.self ? <p className="d21-muted">Another administrator changes your own sign-in and two-step sign-in.</p> : <>
          <div className="d21-toolbar">
            <span className="d21-muted">{m.disabled
              ? "Sign-in is disabled everywhere this person has access."
              : "Disabling ends this person's sign-in everywhere at once. Their records and history stay."}</span>
            <Button kind={m.disabled ? "primary" : "danger"} onClick={() => props.onDisabled(!m.disabled)}>
              {m.disabled ? "Enable sign-in" : "Disable sign-in"}
            </Button>
          </div>
          {m.mfaEnrolled ? <div className="d21-form-grid">
            <div className="d21-form-grid-wide">
              <TextField label="Reason for resetting two-step sign-in" value={reason} onChange={setReason} />
            </div>
            <p className="d21-muted d21-form-grid-wide">Verify the person's identity first. The reason is recorded in the audit trail.</p>
            <div><Button onClick={() => props.onResetMfa(reason.trim())} disabled={!reason.trim()}>Reset two-step sign-in</Button></div>
          </div> : null}
        </>}
        <div className="d21-toolbar">
          {confirmRemove ? <>
            <span className="d21-muted">Remove {m.displayName} from this jurisdiction and end their position assignments here?</span>
            <span className="admin-pair">
              <Button kind="danger" onClick={props.onRemove}>Confirm removal</Button>
              <Button onClick={() => setConfirmRemove(false)}>Cancel</Button>
            </span>
          </> : <>
            <Button kind="danger" onClick={() => setConfirmRemove(true)}>Remove from jurisdiction</Button>
            <Button onClick={props.onClose}>Close</Button>
          </>}
        </div>
      </fieldset>
    </Panel>
  );
}

function AddPerson(props: {
  client: ApiClient; jurisdictionId: string; busy: boolean;
  run: (operation: () => Promise<string>) => Promise<void>;
}) {
  const [mode, setMode] = useState("new");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<MemberRole>("member");
  const submit = () => props.run(async () => {
    if (!email.trim()) throw new Error("Enter the account email.");
    if (mode === "new") {
      if (!displayName.trim()) throw new Error("Enter the person's name.");
      if (password.length < 12) throw new Error("The first password needs at least 12 characters.");
      await props.client.createPerson({ email: email.trim(), displayName: displayName.trim(), password,
        jurisdictionId: props.jurisdictionId, role });
    } else {
      const person = await props.client.findPersonByEmail(email.trim());
      await props.client.setMemberRole(props.jurisdictionId, person.id, role);
    }
    const name = mode === "new" ? displayName.trim() : email.trim();
    setDisplayName(""); setEmail(""); setPassword("");
    return `${name} added as ${ROLE_LABELS[role].toLowerCase()}.`;
  });
  return (
    <Panel title="Add a person">
      <fieldset disabled={props.busy} className="eoc-fieldset eoc-stack">
        <div className="d21-form-grid">
          <EnumSelect label="Account" values={["new", "existing"]} value={mode} onChange={setMode}
            labels={{ new: "Create a new account", existing: "Add an existing account" }} />
          <EnumSelect label="Role in this jurisdiction" values={ROLES} labels={ROLE_LABELS} value={role}
            onChange={(value) => setRole(value as MemberRole)} />
          {mode === "new" ? <TextField label="Name" value={displayName} onChange={setDisplayName} required /> : null}
          <TextField label="Email" value={email} onChange={setEmail} required />
          {mode === "new" ? <TextField label="First password" type="password" value={password} onChange={setPassword} required /> : null}
        </div>
        <div className="d21-toolbar">
          <span className="d21-muted">{mode === "new"
            ? "Give the first password to the person by a separate channel. Administrators enroll in two-step sign-in at their first sign-in."
            : "An existing account keeps its password and its access elsewhere."}</span>
          <Button kind="primary" onClick={() => void submit()}>Add person</Button>
        </div>
      </fieldset>
    </Panel>
  );
}
