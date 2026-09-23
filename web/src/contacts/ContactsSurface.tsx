import { useEffect, useState } from "react";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../design/components.js";
import { Icon } from "../design/icons/index.js";
import "../datasets/datasets.css";
import "./contacts.css";
import { readAllPages, type ApiClient } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ErrorNote, Loading, Scroll, SurfaceHeader } from "../app/screens/parts.js";
import {
  IMPORT_FIELDS,
  normalizePhone,
  splitList,
  type Contact,
  type ContactGroup,
  type ContactImportResult,
  type ImportField,
  type ImportMapping,
} from "./model.js";

type Run = (operation: () => Promise<string>) => Promise<void>;

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const run: Run = async (operation) => {
    setBusy(true); setError(null); setNotice("");
    try { setNotice(await operation()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The change could not be saved."); }
    finally { setBusy(false); }
  };
  const status = <>
    {error ? <p className="d21-error" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </>;
  return { busy, run, status };
}

/**
 * The contacts directory: people to reach during an incident, with or
 * without an account, and groups of them in call-down order. Every member
 * reads it; administrators add, change, group and import contacts.
 */
export function ContactsSurface(props: { client: ApiClient; jurisdictionId: string; isAdmin: boolean }) {
  const { client, jurisdictionId, isAdmin } = props;
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [nonce, setNonce] = useState(0);
  const directory = useAsync(() => client.listContacts(jurisdictionId, query), [jurisdictionId, query, nonce]);
  const [more, setMore] = useState<{ contacts: Contact[]; nextCursor: string | null } | null>(null);
  useEffect(() => setMore(null), [directory.data]);
  const groups = useAsync(
    () => readAllPages((page) => client.listContactGroups(jurisdictionId, page).then((r) => ({ items: r.groups, nextCursor: r.nextCursor }))),
    [jurisdictionId, nonce],
  );
  // Administrators link contacts to people and positions, and build groups from the whole directory.
  const choices = useAsync(
    () => isAdmin
      ? Promise.all([
          readAllPages((page) => client.listContacts(jurisdictionId, "", page).then((r) => ({ items: r.contacts, nextCursor: r.nextCursor }))),
          readAllPages((page) => client.listMembers(jurisdictionId, page).then((r) => ({ items: r.members, nextCursor: r.nextCursor }))),
          client.listPositions(jurisdictionId),
        ])
      : Promise.resolve(null),
    [jurisdictionId, isAdmin, nonce],
  );
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const [editingGroup, setEditingGroup] = useState<ContactGroup | "new" | null>(null);
  const action = useAction();
  const refresh = () => setNonce((n) => n + 1);
  const contacts = [...(directory.data?.contacts ?? []), ...(more?.contacts ?? [])];
  const nextCursor = more ? more.nextCursor : (directory.data?.nextCursor ?? null);
  const people = choices.data?.[1] ?? [];
  const positions = choices.data?.[2] ?? [];

  return (
    <Scroll>
      <SurfaceHeader title="Contacts" actions={isAdmin ? <Button kind="primary" onClick={() => setEditing("new")}>Add contact</Button> : null} />
      <div className="d21-workspace">
        <div className="d21-workspace-intro">
          <Icon name="participants" size={32} decorative />
          <div>
            <strong>Contacts and call-down groups</strong>
            <span>People to reach during an incident, whether or not they have an account here. A group lists contacts in the order a call-down notifies them.</span>
          </div>
        </div>
        {action.status}

        {isAdmin && editing ? (
          <ContactForm key={editing === "new" ? "new" : editing.id} initial={editing === "new" ? null : editing}
            people={people} positions={positions} busy={action.busy}
            onCancel={() => setEditing(null)}
            onSave={(input) => action.run(async () => {
              if (editing === "new") await client.createContact(jurisdictionId, input);
              else await client.updateContact(editing.id, input);
              setEditing(null); refresh();
              return `${input.name} saved.`;
            })} />
        ) : null}

        <Panel title="Directory">
          <form className="d21-card-actions" style={{ alignItems: "flex-end", justifyContent: "flex-start" }}
            onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); }}>
            <TextField label="Search contacts" value={search} onChange={setSearch} />
            <Button type="submit">Search</Button>
          </form>
          {directory.error && !directory.data ? <ErrorNote message={directory.error} /> : null}
          {!directory.data && !directory.error ? <Loading label="Loading contacts…" /> : null}
          {directory.data && contacts.length === 0 ? <p className="d21-muted">{query ? "No contacts match." : "No contacts yet."}</p> : null}
          <ul className="d21-card-grid" style={{ marginTop: 12 }}>
            {contacts.map((contact) => (
              <li key={contact.id} className="d21-card" aria-label={`Contact ${contact.name}`}>
                <div className="d21-card-header">
                  <div>
                    <strong>{contact.name}</strong>
                    <span>{[contact.title, contact.organization].filter(Boolean).join(" · ") || "No title or organization"}</span>
                  </div>
                  {contact.active ? null : <StatusBadge status="unknown">Inactive</StatusBadge>}
                </div>
                <dl className="d21-facts">
                  <div><dt>Email</dt><dd>{contact.emails.join(", ") || "None"}</dd></div>
                  <div><dt>Phone</dt><dd>{contact.phones.join(", ") || "None"}</dd></div>
                  <div><dt>Account</dt><dd>{contact.personName ?? "Not linked"}</dd></div>
                  <div><dt>Position</dt><dd>{contact.positionTitle ?? "Not linked"}</dd></div>
                  {contact.notes ? <div className="d21-form-grid-wide"><dt>Notes</dt><dd>{contact.notes}</dd></div> : null}
                </dl>
                {isAdmin ? (
                  <div className="d21-card-actions" style={{ justifyContent: "flex-start" }}>
                    <Button onClick={() => setEditing(contact)}>Edit</Button>
                    <ConfirmDelete label="Delete" busy={action.busy}
                      question={`Delete ${contact.name}? Past notifications keep what they sent.`}
                      onConfirm={() => void action.run(async () => { await client.deleteContact(contact.id); refresh(); return `${contact.name} deleted.`; })} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {nextCursor ? (
            <div className="d21-toolbar">
              <Button disabled={action.busy} onClick={() => void action.run(async () => {
                const page = await client.listContacts(jurisdictionId, query, { cursor: nextCursor });
                setMore({ contacts: [...(more?.contacts ?? []), ...page.contacts], nextCursor: page.nextCursor });
                return "";
              })}>
                Load more contacts
              </Button>
            </div>
          ) : null}
        </Panel>

        <Panel title="Groups">
          {groups.error && !groups.data ? <ErrorNote message={groups.error} /> : null}
          {groups.data?.length === 0 ? <p className="d21-muted">No groups yet.</p> : null}
          <ul className="d21-readiness-list" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
            {(groups.data ?? []).map((group) => (
              <li key={group.id} className="d21-readiness-row" aria-label={`Group ${group.name}`}>
                <div className="d21-readiness-title">
                  <div><strong>{group.name}</strong><span>{group.members.length === 1 ? "1 contact" : `${group.members.length} contacts`}, in call-down order</span></div>
                </div>
                <ol className="contacts-order">
                  {group.members.map((m) => <li key={m.contactId}>{m.name}{m.active ? "" : " (inactive, skipped)"}</li>)}
                </ol>
                {isAdmin ? (
                  <div className="d21-card-actions" style={{ justifyContent: "flex-start" }}>
                    <Button onClick={() => setEditingGroup(group)}>Edit group</Button>
                    <ConfirmDelete label="Delete group" busy={action.busy}
                      question={`Delete the group ${group.name}? Its contacts stay in the directory.`}
                      onConfirm={() => void action.run(async () => { await client.deleteContactGroup(group.id); refresh(); return `${group.name} deleted.`; })} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {isAdmin && !editingGroup ? (
            <div className="d21-toolbar"><Button onClick={() => setEditingGroup("new")}>New group</Button></div>
          ) : null}
          {isAdmin && editingGroup ? (
            <GroupEditor key={editingGroup === "new" ? "new" : editingGroup.id} initial={editingGroup === "new" ? null : editingGroup}
              contacts={choices.data?.[0] ?? []} busy={action.busy} onCancel={() => setEditingGroup(null)}
              onSave={(name, contactIds) => action.run(async () => {
                if (editingGroup === "new") await client.createContactGroup(jurisdictionId, { name, contactIds });
                else await client.updateContactGroup(editingGroup.id, { name, contactIds });
                setEditingGroup(null); refresh();
                return `Group ${name} saved.`;
              })} />
          ) : null}
        </Panel>

        {isAdmin ? <ContactImport client={client} jurisdictionId={jurisdictionId} onImported={refresh} /> : null}
      </div>
    </Scroll>
  );
}

function ConfirmDelete(props: { label: string; question: string; busy: boolean; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <Button kind="danger" onClick={() => setAsking(true)}>{props.label}</Button>;
  return <>
    <span className="d21-muted">{props.question}</span>
    <Button kind="danger" disabled={props.busy} onClick={() => { setAsking(false); props.onConfirm(); }}>Confirm</Button>
    <Button onClick={() => setAsking(false)}>Keep</Button>
  </>;
}

function ContactForm(props: {
  initial: Contact | null;
  people: ReadonlyArray<{ personId: string; displayName: string }>;
  positions: ReadonlyArray<{ id: string; title: string }>;
  busy: boolean;
  onSave: (input: {
    name: string; organization: string | null; title: string | null; emails: string[]; phones: string[];
    personId: string | null; positionId: string | null; notes: string | null; active: boolean;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const c = props.initial;
  const [name, setName] = useState(c?.name ?? "");
  const [organization, setOrganization] = useState(c?.organization ?? "");
  const [title, setTitle] = useState(c?.title ?? "");
  const [emails, setEmails] = useState(c?.emails.join(", ") ?? "");
  const [phones, setPhones] = useState(c?.phones.join(", ") ?? "");
  const [personId, setPersonId] = useState(c?.personId ?? "");
  const [positionId, setPositionId] = useState(c?.positionId ?? "");
  const [notes, setNotes] = useState(c?.notes ?? "");
  const [active, setActive] = useState(c?.active ?? true);
  return (
    <Panel title={c ? `Edit ${c.name}` : "Add a contact"}>
      <fieldset disabled={props.busy} className="d21-form-grid" style={{ border: 0, padding: 0, margin: 0 }}>
        <TextField label="Name" value={name} onChange={setName} required />
        <TextField label="Organization" value={organization} onChange={setOrganization} />
        <TextField label="Title or role" value={title} onChange={setTitle} />
        <TextField label="Email addresses" value={emails} onChange={setEmails} />
        <TextField label="Phone numbers" value={phones} onChange={setPhones} />
        <EnumSelect label="Linked account" values={["", ...props.people.map((p) => p.personId)]}
          labels={{ "": "None", ...Object.fromEntries(props.people.map((p) => [p.personId, p.displayName])) }}
          value={personId} onChange={setPersonId} />
        <EnumSelect label="Linked position" values={["", ...props.positions.map((p) => p.id)]}
          labels={{ "": "None", ...Object.fromEntries(props.positions.map((p) => [p.id, p.title])) }}
          value={positionId} onChange={setPositionId} />
        <label className="contacts-check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
        <label className="contacts-field d21-form-grid-wide">Notes<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </fieldset>
      <div className="d21-toolbar">
        <span className="d21-muted">Separate several addresses or numbers with commas. Phone numbers need the country code, for example +1 707 555 0100. A linked account or position also gets in-app notices.</span>
        <div className="d21-card-actions">
          <Button onClick={props.onCancel}>Cancel</Button>
          <Button kind="primary" disabled={props.busy} onClick={() => void props.onSave({
            name: name.trim(),
            organization: organization.trim() || null,
            title: title.trim() || null,
            emails: splitList(emails),
            phones: splitList(phones).map(normalizePhone),
            personId: personId || null,
            positionId: positionId || null,
            notes: notes.trim() || null,
            active,
          })}>Save contact</Button>
        </div>
      </div>
    </Panel>
  );
}

function GroupEditor(props: {
  initial: ContactGroup | null;
  contacts: readonly Contact[];
  busy: boolean;
  onSave: (name: string, contactIds: string[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.initial?.name ?? "");
  const [order, setOrder] = useState<string[]>(props.initial?.members.map((m) => m.contactId) ?? []);
  const names = new Map(props.contacts.map((c) => [c.id, c.name]));
  for (const m of props.initial?.members ?? []) if (!names.has(m.contactId)) names.set(m.contactId, m.name);
  const available = props.contacts.filter((c) => !order.includes(c.id));
  const [pick, setPick] = useState("");
  const chosen = available.some((c) => c.id === pick) ? pick : (available[0]?.id ?? "");
  const move = (index: number, by: number) => setOrder((list) => {
    const next = [...list];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    return next;
  });
  return (
    <section aria-label={props.initial ? `Edit group ${props.initial.name}` : "New group"} className="d21-card" style={{ marginTop: 12 }}>
      <fieldset disabled={props.busy} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 10 }}>
        <TextField label="Group name" value={name} onChange={setName} required />
        <ol className="contacts-order" aria-label="Call-down order">
          {order.map((id, index) => (
            <li key={id}>
              <span>{names.get(id) ?? "Contact"}</span>
              <span className="d21-card-actions" style={{ justifyContent: "flex-start" }}>
                <Button disabled={index === 0} onClick={() => move(index, -1)}>Move up</Button>
                <Button disabled={index === order.length - 1} onClick={() => move(index, 1)}>Move down</Button>
                <Button onClick={() => setOrder((list) => list.filter((x) => x !== id))}>Remove</Button>
              </span>
            </li>
          ))}
        </ol>
        {available.length ? (
          <div className="d21-card-actions" style={{ alignItems: "flex-end", justifyContent: "flex-start" }}>
            <EnumSelect label="Add a contact" values={available.map((c) => c.id)}
              labels={Object.fromEntries(available.map((c) => [c.id, c.name]))} value={chosen} onChange={setPick} />
            <Button onClick={() => chosen && setOrder((list) => [...list, chosen])}>Add to group</Button>
          </div>
        ) : null}
      </fieldset>
      <div className="d21-card-actions" style={{ justifyContent: "flex-start" }}>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button kind="primary" disabled={props.busy || !name.trim()} onClick={() => void props.onSave(name.trim(), order)}>Save group</Button>
      </div>
    </section>
  );
}

const FIELD_LABELS: Readonly<Record<ImportField, string>> = {
  name: "Name",
  organization: "Organization",
  title: "Title or role",
  email: "Email addresses",
  phone: "Phone numbers",
  notes: "Notes",
};

function ContactImport(props: { client: ApiClient; jurisdictionId: string; onImported: () => void }) {
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<ContactImportResult | null>(null);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const action = useAction();
  const check = (withMapping: ImportMapping | null) => action.run(async () => {
    if (!csv.trim()) throw new Error("Choose a CSV file or paste its contents.");
    const checked = await props.client.importContacts(props.jurisdictionId, { csv, dryRun: true, ...(withMapping ? { mapping: withMapping } : {}) });
    setResult(checked);
    setMapping(checked.mapping);
    return checked.invalid ? `${checked.invalid} of ${checked.rows.length} rows need correcting before import.` : `${checked.valid} contacts ready to import.`;
  });
  return (
    <Panel title="Import from CSV">
      <fieldset disabled={action.busy} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 10 }}>
        <label className="contacts-field">CSV file
          <input type="file" accept=".csv,text/csv" onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void file.text().then((text) => { setCsv(text); setResult(null); setMapping(null); });
          }} />
        </label>
        <label className="contacts-field">CSV contents<textarea rows={5} value={csv} onChange={(e) => { setCsv(e.target.value); setResult(null); setMapping(null); }} /></label>
        {result && mapping ? (
          <div className="d21-form-grid">
            {IMPORT_FIELDS.map((field) => (
              <EnumSelect key={field} label={`Column for ${FIELD_LABELS[field].toLowerCase()}`} values={["", ...result.headers]}
                labels={{ "": "Not imported" }} value={mapping[field] ?? ""}
                onChange={(column) => setMapping({ ...mapping, [field]: column || null })} />
            ))}
          </div>
        ) : null}
      </fieldset>
      {action.status}
      {result ? (
        <ul className="contacts-import-rows" aria-label="Rows to import">
          {result.rows.map((row) => (
            <li key={row.row} aria-label={`Row ${row.row}`}>
              <strong>Row {row.row}: {row.name || "(no name)"}</strong>
              <span className="d21-muted"> {[row.organization, ...row.emails, ...row.phones].filter(Boolean).join(" · ")}</span>
              {row.errors.length ? <span className="d21-error">{row.errors.join("; ")}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="d21-toolbar">
        <span className="d21-muted">The first row names the columns. Checking the file writes nothing; the import adds every row or none.</span>
        <div className="d21-card-actions">
          <Button onClick={() => void check(mapping)}>Check file</Button>
          <Button kind="primary" disabled={action.busy || !result || result.invalid > 0 || !mapping}
            onClick={() => void action.run(async () => {
              const done = await props.client.importContacts(props.jurisdictionId, { csv, dryRun: false, mapping: mapping! });
              setResult(null); setMapping(null); setCsv("");
              props.onImported();
              return `${done.created} contacts imported.`;
            })}>{result && result.invalid === 0 ? `Import ${result.valid} contacts` : "Import contacts"}</Button>
        </div>
      </div>
    </Panel>
  );
}
