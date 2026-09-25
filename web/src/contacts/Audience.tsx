import { readAllPages, type ApiClient } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ErrorNote } from "../app/screens/parts.js";
import { EnumSelect, TextField } from "../design/components.js";
import "../datasets/datasets.css";
import "./contacts.css";
import { CHANNEL_LABELS, type Audience, type MassChannel } from "./model.js";

const CHANNELS: readonly MassChannel[] = ["email", "sms", "inapp"];
const FIRST_DEVICE = ["sms", "email"] as const;
const FIRST_DEVICE_LABELS = { sms: "SMS first, then email", email: "Email first, then SMS" };

/** How a send goes out: its channels and, for a broadcast, whether it falls back from one device to the next. */
export interface DeliveryChoiceValue {
  readonly channels: ReadonlySet<MassChannel>;
  readonly fallback: boolean;
  readonly first: "sms" | "email";
  readonly minutes: string;
}

export const DEFAULT_DELIVERY: DeliveryChoiceValue = { channels: new Set(["email", "sms"]), fallback: false, first: "sms", minutes: "10" };

/**
 * The channels in the order a send takes them. With a fallback, SMS and email
 * go in the order chosen and the in-app notice at once; otherwise all at once.
 */
export function orderedChannels(chosen: ReadonlySet<MassChannel>, first: "sms" | "email" | null): MassChannel[] {
  if (!first) return CHANNELS.filter((c) => chosen.has(c));
  const second = first === "sms" ? "email" : "sms";
  return ([first, second, "inapp"] as const).filter((c) => chosen.has(c));
}

/** The channels and fallback a send takes; throws the reason in the operator's words. */
export function deliveryOf(value: DeliveryChoiceValue, allowFallback: boolean): { channels: MassChannel[]; fallbackMinutes?: number } {
  if (value.channels.size === 0) throw new Error("Choose at least one channel.");
  if (!(allowFallback && value.fallback && value.channels.has("sms") && value.channels.has("email")))
    return { channels: orderedChannels(value.channels, null) };
  const minutes = Number(value.minutes);
  if (!(Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440))
    throw new Error("Enter the minutes to wait before the next device, from 1 to 1440.");
  return { channels: orderedChannels(value.channels, value.first), fallbackMinutes: minutes };
}

/** The channels to send on and, for a broadcast with both SMS and email, the fallback between them. */
export function DeliveryChoice(props: {
  readonly value: DeliveryChoiceValue;
  readonly onChange: (next: DeliveryChoiceValue) => void;
  readonly allowFallback: boolean;
}) {
  const { value, onChange } = props;
  const offered = props.allowFallback && value.channels.has("sms") && value.channels.has("email");
  return (
    <>
      <fieldset className="contacts-checks d21-form-grid-wide">
        <legend>Channels</legend>
        {CHANNELS.map((c) => (
          <label key={c} className="contacts-check">
            <input type="checkbox" checked={value.channels.has(c)} onChange={(event) => {
              const next = new Set(value.channels);
              if (event.target.checked) next.add(c); else next.delete(c);
              onChange({ ...value, channels: next });
            }} />
            {CHANNEL_LABELS[c]}
          </label>
        ))}
        {offered ? (
          <label className="contacts-check">
            <input type="checkbox" checked={value.fallback} onChange={(event) => onChange({ ...value, fallback: event.target.checked })} />
            If someone does not acknowledge, try their next device
          </label>
        ) : null}
      </fieldset>
      {offered && value.fallback ? (
        <>
          <EnumSelect label="Order" values={FIRST_DEVICE} labels={FIRST_DEVICE_LABELS} value={value.first}
            onChange={(v) => onChange({ ...value, first: v as "sms" | "email" })} />
          <TextField label="Minutes to wait before the next device" value={value.minutes}
            onChange={(v) => onChange({ ...value, minutes: v })} />
        </>
      ) : null}
    </>
  );
}

/** Each part of an audience as the picker holds it: ids in the order chosen. */
export type AudienceParts = { readonly [K in keyof Audience]-?: readonly string[] };

export const NO_AUDIENCE: AudienceParts = { groupIds: [], contactIds: [], positionIds: [], onCallPositionIds: [] };

/**
 * Whom a message reaches (VA7): contact groups, chosen contacts, whoever holds
 * a position, and whoever is on shift in a position now. The server resolves
 * each part when it sends and reaches everyone once; a position with no one
 * on shift reaches its holders, and the receipts say so.
 */
export function AudiencePicker(props: {
  readonly client: ApiClient;
  readonly jurisdictionId: string;
  readonly value: AudienceParts;
  readonly onChange: (next: AudienceParts) => void;
  /** Offer single contacts from the directory as well as groups and positions. */
  readonly contacts?: boolean;
}) {
  const { client, jurisdictionId, value, onChange } = props;
  const groups = useAsync(
    () => readAllPages((page) => client.listContactGroups(jurisdictionId, page).then((r) => ({ items: r.groups, nextCursor: r.nextCursor }))),
    [jurisdictionId],
  );
  const directory = useAsync(
    () => props.contacts
      ? readAllPages((page) => client.listContacts(jurisdictionId, "", page).then((r) => ({ items: r.contacts, nextCursor: r.nextCursor })))
      : Promise.resolve([]),
    [jurisdictionId, props.contacts],
  );
  const positions = useAsync(() => client.listPositions(jurisdictionId), [jurisdictionId]);
  const toggle = (part: keyof AudienceParts, id: string, on: boolean) =>
    onChange({ ...value, [part]: on ? [...value[part], id] : value[part].filter((x) => x !== id) });
  const check = (part: keyof AudienceParts, id: string, label: string, name?: string) => (
    <label key={id} className="contacts-check">
      <input type="checkbox" checked={value[part].includes(id)} aria-label={name}
        onChange={(event) => toggle(part, id, event.target.checked)} />
      {label}
    </label>
  );
  const positionList = [...(positions.data ?? [])].sort((a, b) => a.title.localeCompare(b.title));

  return (
    <>
      {groups.error ? <ErrorNote message={groups.error} /> : null}
      {positions.error ? <ErrorNote message={positions.error} /> : null}
      <fieldset className="contacts-checks d21-form-grid-wide">
        <legend>Contact groups</legend>
        {(groups.data ?? []).map((g) => check("groupIds", g.id, `${g.name} (${g.members.length})`))}
        {groups.data?.length === 0 ? <span className="d21-muted">No contact groups yet. Add them under Contacts.</span> : null}
      </fieldset>
      {props.contacts ? (
        <fieldset className="contacts-checks d21-form-grid-wide">
          <legend>Contacts, notified in the order chosen</legend>
          {(directory.data ?? []).filter((c) => c.active).map((c) => check("contactIds", c.id, c.name))}
        </fieldset>
      ) : null}
      <fieldset className="contacts-checks d21-form-grid-wide">
        <legend>Positions: whoever holds each now</legend>
        {positionList.map((p) => check("positionIds", p.id, p.title))}
      </fieldset>
      <fieldset className="contacts-checks d21-form-grid-wide">
        <legend>On call: whoever is on shift in each now</legend>
        {positionList.map((p) => check("onCallPositionIds", p.id, p.title, `On call: ${p.title}`))}
      </fieldset>
    </>
  );
}
