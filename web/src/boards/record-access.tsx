import type { RecordAccess } from "@openeoc/shared";
import { ActionButton } from "../design/controls.js";
import { Panel } from "../design/components.js";

type Grant = RecordAccess["read"][number];
type Choice = "role:member" | "role:viewer" | "role:guest" | "creator" | "creator_position" | "assigned_position";

const CHOICES: ReadonlyArray<{ readonly id: Choice; readonly label: string; readonly help: string; readonly readOnly?: true }> = [
  { id: "role:member", label: "Board members",
    help: "Everyone holding the member role on this board. An incident participant from another organization counts as a member." },
  { id: "role:viewer", label: "Board viewers", help: "Everyone holding the viewer role on this board.", readOnly: true },
  { id: "role:guest", label: "Guests", help: "People with a guest grant to this organization.", readOnly: true },
  { id: "creator", label: "The record's creator", help: "The person who created the record." },
  { id: "creator_position", label: "The creator's position",
    help: "Anyone assigned to the position the record was created under." },
  { id: "assigned_position", label: "The assigned position",
    help: "Anyone assigned to the position the record's workflow is currently assigned to. Needs workflow routing." },
];

function choicesOf(grants: readonly Grant[]): Set<Choice> {
  const out = new Set<Choice>();
  for (const grant of grants) {
    if (grant.kind === "role") for (const role of grant.roles) out.add(`role:${role}`);
    else out.add(grant.kind);
  }
  return out;
}

/** Choices back to grants: the chosen roles as one role grant, then each other kind. */
function grantsOf(choices: ReadonlySet<Choice>): Grant[] {
  const roles = (["member", "viewer", "guest"] as const).filter((role) => choices.has(`role:${role}`));
  const others = (["creator", "creator_position", "assigned_position"] as const).filter((kind) => choices.has(kind));
  return [...(roles.length ? [{ kind: "role" as const, roles }] : []), ...others.map((kind) => ({ kind }))];
}

const STARTER: RecordAccess = { read: [{ kind: "creator" }, { kind: "creator_position" }], edit: [{ kind: "creator" }, { kind: "creator_position" }] };

/**
 * Structured controls for a template's record access rule: who reads and who
 * edits each record beyond the board roles. Any checked grant is enough.
 */
export function RecordAccessEditor(props: {
  readonly value: RecordAccess | undefined;
  readonly hasWorkflow: boolean;
  readonly onChange: (value: RecordAccess | undefined) => void;
}) {
  if (!props.value) return <Panel title="Record access">
    <p>Every person who can read this board reads and edits every record, as their board role allows.</p>
    <ActionButton kind="primary" onClick={() => props.onChange(STARTER)}>Restrict individual records</ActionButton>
  </Panel>;
  const access = props.value;
  const group = (list: "read" | "edit") => {
    const chosen = choicesOf(access[list]);
    return <fieldset className="board-designer__checks board-access__grants">
      <legend>{list === "read" ? "Who may read a record" : "Who may edit a record"}</legend>
      {CHOICES.filter((choice) => list === "read" || !choice.readOnly).map((choice) => {
        const disabled = choice.id === "assigned_position" && !props.hasWorkflow && !chosen.has(choice.id);
        return <label key={choice.id} className="board-designer__check board-access__grant">
          <input type="checkbox" checked={chosen.has(choice.id)} disabled={disabled}
            aria-label={`${list === "read" ? "Read" : "Edit"}: ${choice.label}`}
            onChange={(event) => {
              const next = new Set(chosen);
              if (event.target.checked) next.add(choice.id);
              else next.delete(choice.id);
              props.onChange({ ...access, [list]: grantsOf(next) });
            }} />
          <span><strong>{choice.label}</strong><small>{choice.help}</small></span>
        </label>;
      })}
    </fieldset>;
  };
  const read = choicesOf(access.read);
  return <Panel title="Record access">
    <div className="board-designer__stack">
      <p>Jurisdiction administrators always read and edit every record. Anyone a rule leaves out finds no
        trace of the record in views, exports, references, history, dashboards or the map. A person who cannot read
        every record syncs this board per record: their device is sent no records from it, and each record they
        send is written through this rule.</p>
      {group("read")}
      {!read.has("creator") && !read.has("creator_position")
        ? <p role="note">Writers lose sight of the records they submit unless the creator or the creator&apos;s position may read them.</p>
        : null}
      {group("edit")}
      <p>Notification rules and sharing agreements an administrator configures are not governed by this rule.</p>
      <ActionButton kind="danger" onClick={() => props.onChange(undefined)}>Remove record restriction</ActionButton>
    </div>
  </Panel>;
}
