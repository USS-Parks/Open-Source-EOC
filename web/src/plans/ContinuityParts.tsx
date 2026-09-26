import type { Continuity } from "@openeoc/shared";
import { Button, EnumSelect, TextField } from "../design/components.js";

/**
 * A continuity plan's own parts on screen (VC-19): the essential functions
 * with the hours each must be restored within and the position that
 * restores it, the recovery locations, the orders of succession and the
 * delegations of authority. Lists are typed one item per line.
 */

export interface FunctionDraft {
  readonly name: string;
  readonly description: string;
  readonly priority: string;
  readonly recoveryHours: string;
  readonly position: string;
  readonly resources: string;
  readonly vitalRecords: string;
}

export interface LocationDraft { readonly name: string; readonly address: string; readonly capacity: string; readonly notes: string }
export interface SuccessionDraft { readonly role: string; readonly successors: string }
export interface DelegationDraft { readonly authority: string; readonly delegatedTo: string; readonly when: string; readonly limits: string }

export interface ContinuityDraft {
  readonly functions: readonly FunctionDraft[];
  readonly locations: readonly LocationDraft[];
  readonly succession: readonly SuccessionDraft[];
  readonly delegations: readonly DelegationDraft[];
}

const EMPTY_FUNCTION: FunctionDraft = { name: "", description: "", priority: "1", recoveryHours: "24", position: "", resources: "", vitalRecords: "" };
const EMPTY_LOCATION: LocationDraft = { name: "", address: "", capacity: "", notes: "" };
const EMPTY_SUCCESSION: SuccessionDraft = { role: "", successors: "" };
const EMPTY_DELEGATION: DelegationDraft = { authority: "", delegatedTo: "", when: "", limits: "" };

export const emptyContinuity = (): ContinuityDraft => ({ functions: [EMPTY_FUNCTION], locations: [], succession: [], delegations: [] });

const lines = (text: string): string[] => text.split("\n").map((line) => line.trim()).filter(Boolean);

export function continuityDraftFrom(c: Continuity): ContinuityDraft {
  return {
    functions: c.essentialFunctions.map((fn) => ({
      name: fn.name, description: fn.description, priority: String(fn.priority), recoveryHours: String(fn.recoveryHours),
      position: fn.position, resources: fn.resources.join("\n"), vitalRecords: fn.vitalRecords.join("\n"),
    })),
    locations: c.recoveryLocations.map((location) => ({
      name: location.name, address: location.address, capacity: location.capacity ? String(location.capacity) : "", notes: location.notes,
    })),
    succession: c.succession.map((entry) => ({ role: entry.role, successors: entry.successors.join("\n") })),
    delegations: c.delegations.map((entry) => ({ ...entry })),
  };
}

function whole(text: string, what: string): number {
  const value = Number(text.trim());
  if (!/^\d+$/.test(text.trim()) || !Number.isFinite(value)) throw new Error(`${what}: enter a whole number.`);
  return value;
}

/** The continuity parts the draft describes; throws with the reason when a field is not filled in. */
export function continuityFrom(draft: ContinuityDraft): Continuity {
  if (draft.functions.length === 0) throw new Error("Add at least one essential function.");
  return {
    essentialFunctions: draft.functions.map((fn, index) => {
      const n = index + 1;
      if (!fn.name.trim()) throw new Error(`Essential function ${n}: enter its name.`);
      if (!fn.position) throw new Error(`Essential function ${n}: choose the position that restores it.`);
      return {
        name: fn.name.trim(), description: fn.description, priority: whole(fn.priority, `Essential function ${n} priority`),
        recoveryHours: whole(fn.recoveryHours, `Essential function ${n} restore within`), position: fn.position,
        resources: [...new Set(lines(fn.resources))], vitalRecords: [...new Set(lines(fn.vitalRecords))],
      };
    }),
    recoveryLocations: draft.locations.map((location, index) => {
      if (!location.name.trim()) throw new Error(`Recovery location ${index + 1}: enter its name.`);
      return {
        name: location.name.trim(), address: location.address.trim(), notes: location.notes,
        ...(location.capacity.trim() ? { capacity: whole(location.capacity, `Recovery location ${index + 1} seats`) } : {}),
      };
    }),
    succession: draft.succession.map((entry, index) => {
      const successors = lines(entry.successors);
      if (!entry.role.trim() || successors.length === 0) throw new Error(`Succession ${index + 1}: enter the role and at least one successor.`);
      return { role: entry.role.trim(), successors };
    }),
    delegations: draft.delegations.map((entry, index) => {
      if (!entry.authority.trim() || !entry.delegatedTo.trim()) throw new Error(`Delegation ${index + 1}: enter the authority and who holds it.`);
      return { authority: entry.authority.trim(), delegatedTo: entry.delegatedTo.trim(), when: entry.when.trim(), limits: entry.limits.trim() };
    }),
  };
}

function Lines(props: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void }) {
  return (
    <label className="incidents-field">{props.label}
      <textarea rows={2} value={props.value} onChange={(event) => props.onChange(event.target.value)} />
    </label>
  );
}

export function ContinuityEditor(props: {
  readonly draft: ContinuityDraft;
  readonly onChange: (next: ContinuityDraft) => void;
  /** The positions the plan's template opens, which may restore a function. */
  readonly positions: ReadonlyArray<{ readonly key: string; readonly title: string }>;
}) {
  const d = props.draft;
  const set = <K extends keyof ContinuityDraft>(key: K, index: number, change: Partial<ContinuityDraft[K][number]>) =>
    props.onChange({ ...d, [key]: d[key].map((item, i) => (i === index ? { ...item, ...change } : item)) });
  const add = <K extends keyof ContinuityDraft>(key: K, item: ContinuityDraft[K][number]) => props.onChange({ ...d, [key]: [...d[key], item] });
  const remove = (key: keyof ContinuityDraft, index: number) => props.onChange({ ...d, [key]: d[key].filter((_, i) => i !== index) });
  const positionLabels = { "": "Choose a position", ...Object.fromEntries(props.positions.map((p) => [p.key, p.title])) };
  return (
    <>
      <fieldset className="incidents-fieldset">
        <legend>Essential functions</legend>
        <p className="eoc-muted eoc-flush">Activating the plan opens a task per function for its position, due within its hours, in priority order.</p>
        {d.functions.map((fn, index) => {
          const n = index + 1;
          return (
            <div key={index} className="plans-block" role="group" aria-label={`Essential function ${n}`}>
              <div className="plans-task-row">
                <TextField label={`Function ${n} name`} value={fn.name} onChange={(name) => set("functions", index, { name })} />
                <TextField label={`Function ${n} priority`} value={fn.priority} onChange={(priority) => set("functions", index, { priority })} />
                <TextField label={`Function ${n} restore within (hours)`} value={fn.recoveryHours} onChange={(recoveryHours) => set("functions", index, { recoveryHours })} />
                <EnumSelect label={`Function ${n} restored by`} values={["", ...props.positions.map((p) => p.key)]} value={fn.position}
                  onChange={(position) => set("functions", index, { position })} labels={positionLabels} />
              </div>
              <Lines label={`Function ${n} description`} value={fn.description} onChange={(description) => set("functions", index, { description })} />
              <Lines label={`Function ${n} resources, one per line`} value={fn.resources} onChange={(resources) => set("functions", index, { resources })} />
              <Lines label={`Function ${n} vital records, one per line`} value={fn.vitalRecords} onChange={(vitalRecords) => set("functions", index, { vitalRecords })} />
              <Button onClick={() => remove("functions", index)}>Remove function {n}</Button>
            </div>
          );
        })}
        <div className="plans-add"><Button onClick={() => add("functions", { ...EMPTY_FUNCTION, priority: String(d.functions.length + 1) })}>Add an essential function</Button></div>
      </fieldset>
      <fieldset className="incidents-fieldset">
        <legend>Recovery locations</legend>
        {d.locations.map((location, index) => {
          const n = index + 1;
          return (
            <div key={index} className="plans-task-row" role="group" aria-label={`Recovery location ${n}`}>
              <TextField label={`Location ${n} name`} value={location.name} onChange={(name) => set("locations", index, { name })} />
              <TextField label={`Location ${n} address`} value={location.address} onChange={(address) => set("locations", index, { address })} />
              <TextField label={`Location ${n} staff it seats`} value={location.capacity} onChange={(capacity) => set("locations", index, { capacity })} />
              <TextField label={`Location ${n} notes`} value={location.notes} onChange={(notes) => set("locations", index, { notes })} />
              <Button onClick={() => remove("locations", index)}>Remove location {n}</Button>
            </div>
          );
        })}
        <div className="plans-add"><Button onClick={() => add("locations", EMPTY_LOCATION)}>Add a recovery location</Button></div>
      </fieldset>
      <fieldset className="incidents-fieldset">
        <legend>Orders of succession</legend>
        {d.succession.map((entry, index) => {
          const n = index + 1;
          return (
            <div key={index} className="plans-task-row" role="group" aria-label={`Succession ${n}`}>
              <TextField label={`Succession ${n} role`} value={entry.role} onChange={(role) => set("succession", index, { role })} />
              <Lines label={`Succession ${n} successors, in order, one per line`} value={entry.successors} onChange={(successors) => set("succession", index, { successors })} />
              <Button onClick={() => remove("succession", index)}>Remove succession {n}</Button>
            </div>
          );
        })}
        <div className="plans-add"><Button onClick={() => add("succession", EMPTY_SUCCESSION)}>Add an order of succession</Button></div>
      </fieldset>
      <fieldset className="incidents-fieldset">
        <legend>Delegations of authority</legend>
        {d.delegations.map((entry, index) => {
          const n = index + 1;
          return (
            <div key={index} className="plans-task-row" role="group" aria-label={`Delegation ${n}`}>
              <TextField label={`Delegation ${n} authority`} value={entry.authority} onChange={(authority) => set("delegations", index, { authority })} />
              <TextField label={`Delegation ${n} delegated to`} value={entry.delegatedTo} onChange={(delegatedTo) => set("delegations", index, { delegatedTo })} />
              <TextField label={`Delegation ${n} takes effect when`} value={entry.when} onChange={(when) => set("delegations", index, { when })} />
              <TextField label={`Delegation ${n} limits`} value={entry.limits} onChange={(limits) => set("delegations", index, { limits })} />
              <Button onClick={() => remove("delegations", index)}>Remove delegation {n}</Button>
            </div>
          );
        })}
        <div className="plans-add"><Button onClick={() => add("delegations", EMPTY_DELEGATION)}>Add a delegation of authority</Button></div>
      </fieldset>
    </>
  );
}

const hoursLabel = (hours: number): string =>
  hours % 24 === 0 ? `${hours / 24} day${hours === 24 ? "" : "s"}` : `${hours} hour${hours === 1 ? "" : "s"}`;

/** A continuity plan's parts as its readers see them, functions in priority order. */
export function ContinuityView(props: { readonly continuity: Continuity; readonly positionTitle: (key: string) => string }) {
  const c = props.continuity;
  const functions = [...c.essentialFunctions].sort((a, b) => a.priority - b.priority);
  return (
    <div className="plans-continuity">
      <table className="plans-table">
        <caption>Essential functions</caption>
        <thead><tr><th scope="col">Priority</th><th scope="col">Function</th><th scope="col">Restore within</th>
          <th scope="col">Restored by</th><th scope="col">Resources and vital records</th></tr></thead>
        <tbody>
          {functions.map((fn) => (
            <tr key={fn.name}>
              <td>{fn.priority}</td>
              <td><strong>{fn.name}</strong>{fn.description ? <><br />{fn.description}</> : null}</td>
              <td>{hoursLabel(fn.recoveryHours)}</td>
              <td>{props.positionTitle(fn.position)}</td>
              <td>{[...fn.resources, ...fn.vitalRecords].join("; ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {c.recoveryLocations.length ? (
        <>
          <h4>Recovery locations</h4>
          <ul className="plans-tasks">
            {c.recoveryLocations.map((location) => (
              <li key={location.name}>
                <strong>{location.name}</strong>{location.address ? `, ${location.address}` : ""}
                {location.capacity ? `, seats ${location.capacity}` : ""}{location.notes ? `. ${location.notes}` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {c.succession.length ? (
        <>
          <h4>Orders of succession</h4>
          <ul className="plans-tasks">
            {c.succession.map((entry) => <li key={entry.role}><strong>{entry.role}</strong>: {entry.successors.join(", then ")}</li>)}
          </ul>
        </>
      ) : null}
      {c.delegations.length ? (
        <>
          <h4>Delegations of authority</h4>
          <ul className="plans-tasks">
            {c.delegations.map((entry) => (
              <li key={`${entry.authority}:${entry.delegatedTo}`}>
                <strong>{entry.authority}</strong> to {entry.delegatedTo}.{entry.when ? ` Takes effect: ${entry.when.replace(/\.$/, "")}.` : ""}
                {entry.limits ? ` Limits: ${entry.limits.replace(/\.$/, "")}.` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
