import { useState } from "react";
import { Button, EnumSelect, Panel, TextField } from "../design/components.js";
import type { ApiClient, PositionRef } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ErrorNote, Loading } from "../app/screens/parts.js";

/**
 * Positions and who holds them. Assign adds a holder, reassign replaces every
 * current holder at shift change, revoke ends one person's assignment.
 */
export function Positions(props: { client: ApiClient; jurisdictionId: string }) {
  const positions = useAsync(() => props.client.listPositions(props.jurisdictionId), [props.jurisdictionId]);
  const holders = useAsync(() => props.client.listPositionHolders(props.jurisdictionId), [props.jurisdictionId]);
  // ponytail: one page of up to 500 people feeds the picker; page it if a jurisdiction outgrows that.
  const people = useAsync(() => props.client.listMembers(props.jurisdictionId, { limit: 500 }), [props.jurisdictionId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [key, setKey] = useState("");
  const [title, setTitle] = useState("");

  const run = async (operation: () => Promise<string>) => {
    setBusy(true); setError(null); setNotice("");
    try { setNotice(await operation()); positions.reload(); holders.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The change could not be saved."); }
    finally { setBusy(false); }
  };
  const candidates = (people.data?.members ?? []).filter((m) => !m.disabled);
  const nameOf = (personId: string) => candidates.find((m) => m.personId === personId)?.displayName ?? "the selected person";

  if (positions.error) return <ErrorNote message={positions.error} />;
  if (!positions.data || !holders.data) return <Loading label="Loading positions…" />;
  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      {error ? <p className="d21-error" role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <p className="d21-muted">Assign adds a holder. Reassign replaces the current holders at shift change. Revoke ends one person's assignment; someone already acting in the position keeps it until they sign out of it.</p>
      <ul className="d21-readiness-list">
        {positions.data.map((position) => (
          <PositionCard key={position.id} position={position} busy={busy}
            holders={holders.data!.filter((h) => h.positionId === position.id)}
            candidates={candidates}
            onAssign={(personId, replace) => run(async () => {
              if (replace) await props.client.reassignPosition(position.id, personId);
              else await props.client.assignPosition(position.id, personId);
              return `${nameOf(personId)} ${replace ? "now holds" : "was assigned"} ${position.title}.`;
            })}
            onRevoke={(personId, name) => run(async () => {
              await props.client.revokePositionAssignment(position.id, personId);
              return `${name} no longer holds ${position.title}.`;
            })} />
        ))}
      </ul>
      <Panel title="Add a position">
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 12 }}>
          <div className="d21-form-grid">
            <TextField label="Position title" value={title} onChange={setTitle} required />
            <TextField label="Short code" value={key} onChange={setKey} required />
          </div>
          <div className="d21-toolbar">
            <span className="d21-muted">The short code identifies the position in exports, for example planning_unit_leader.</span>
            <Button kind="primary" onClick={() => void run(async () => {
              if (!title.trim() || !key.trim()) throw new Error("Enter a title and a short code.");
              await props.client.createPosition(props.jurisdictionId, { key: key.trim(), title: title.trim() });
              setKey(""); setTitle("");
              return `${title.trim()} added.`;
            })}>Add position</Button>
          </div>
        </fieldset>
      </Panel>
    </div>
  );
}

function PositionCard(props: {
  position: PositionRef;
  holders: ReadonlyArray<{ personId: string; displayName: string }>;
  candidates: ReadonlyArray<{ personId: string; displayName: string }>;
  busy: boolean;
  onAssign: (personId: string, replace: boolean) => void;
  onRevoke: (personId: string, name: string) => void;
}) {
  const held = new Set(props.holders.map((h) => h.personId));
  const options = props.candidates.filter((c) => !held.has(c.personId));
  const [personId, setPersonId] = useState("");
  const chosen = options.some((o) => o.personId === personId) ? personId : (options[0]?.personId ?? "");
  return (
    <li className="d21-readiness-row" aria-label={props.position.title}>
      <div className="d21-readiness-title">
        <div>
          <strong>{props.position.title}</strong>
          <span>{props.holders.length === 0 ? "Vacant" : `Held by ${props.holders.map((h) => h.displayName).join(", ")}`}</span>
        </div>
      </div>
      <fieldset disabled={props.busy} style={{ border: 0, padding: 0, margin: 0, gridColumn: "1 / -1", display: "grid", gap: 8 }}>
        {options.length > 0 ? <div className="d21-card-actions" style={{ alignItems: "flex-end", justifyContent: "flex-start" }}>
          <EnumSelect label={`Person for ${props.position.title}`} values={options.map((o) => o.personId)}
            labels={Object.fromEntries(options.map((o) => [o.personId, o.displayName]))}
            value={chosen} onChange={setPersonId} />
          <Button onClick={() => props.onAssign(chosen, false)}>Assign</Button>
          {props.holders.length > 0 ? <Button onClick={() => props.onAssign(chosen, true)}>Reassign</Button> : null}
        </div> : null}
        {props.holders.length > 0 ? <div className="d21-card-actions" style={{ justifyContent: "flex-start" }}>
          {props.holders.map((h) => (
            <Button key={h.personId} kind="danger" onClick={() => props.onRevoke(h.personId, h.displayName)}>
              Revoke {h.displayName}
            </Button>
          ))}
        </div> : null}
      </fieldset>
    </li>
  );
}
