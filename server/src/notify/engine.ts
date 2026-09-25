import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { BoardTemplateSchema, choiceLabel, effectiveFields, type FieldDef } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { AuthError, type Principal } from "../auth/service.js";
import { audienceLabel, resolveAudience } from "../contacts/reach.js";
import { E164 } from "./channels.js";

/**
 * Notification engine (F4). Rules are data: an event, an optional
 * condition over the record, and a channel list. Delivery is post-commit
 * (never inside the mutating transaction) and every attempt lands as a
 * logged notification row, pending until the outbox worker settles it as
 * delivered or failed; a dead channel is a visible record, not a silent drop.
 */

export const ConditionSchema = z.object({
  field: z.string().min(1).optional(),
  op: z.enum(["any", "eq", "changed_to"]).default("any"),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type Condition = z.infer<typeof ConditionSchema>;

/** How a group or position channel reaches each person: in the app, by email, by SMS. */
const Via = z.array(z.enum(["inapp", "email", "sms"])).min(1).max(3);

export const ChannelSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inapp"), target: z.enum(["requesting_position"]) }),
  z.object({ kind: z.literal("webhook"), url: z.string().url() }),
  z.object({ kind: z.literal("ntfy"), url: z.string().url(), topic: z.string().min(1) }),
  z.object({ kind: z.literal("email"), to: z.array(z.email()).min(1).max(50) }),
  z.object({ kind: z.literal("sms"), to: z.array(E164).min(1).max(50) }),
  // People by where they sit, resolved when the rule fires (contacts/reach.ts).
  z.object({ kind: z.literal("group"), groupId: z.string().uuid(), via: Via }),
  z.object({
    kind: z.literal("position"),
    positionId: z.string().uuid(),
    reach: z.enum(["holders", "on_call"]).default("holders"),
    via: Via,
  }),
]);
export type Channel = z.infer<typeof ChannelSchema>;

export interface BoardEvent {
  readonly jurisdictionId: string;
  readonly boardId: string;
  readonly boardKey: string;
  readonly recordId: string;
  readonly event: "record.created" | "record.updated";
  readonly record: Record<string, unknown>;
  readonly previous?: Record<string, unknown> | undefined;
}

/** Pure condition evaluation; unit-tested directly. */
export function matches(condition: Condition, event: BoardEvent): boolean {
  if (condition.op === "any" || !condition.field) return true;
  const current = event.record[condition.field];
  if (condition.op === "eq") return current === condition.value;
  // changed_to: it is the value now and was not before.
  return current === condition.value && event.previous?.[condition.field] !== condition.value;
}

export function signWebhookBody(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Evaluate the rules for a board event and record what they ask for. Runs
 * inside the caller's write transaction and never touches the network: an
 * in-app notice is written as delivered, and a webhook, push, email or SMS is
 * written as a pending notification plus a delivery row that the outbox
 * worker sends, one per email or SMS recipient.
 * A rule over its rate cap queues nothing more for the window; the database
 * counts the suppressed deliveries on one notification an admin can see.
 */
export async function notifyBoardEvent(
  tx: Sql,
  actor: Principal,
  event: BoardEvent,
): Promise<void> {
  // A fixed order keeps concurrent writers locking suppression notices alike.
  const rules = await tx`
    select id, board_id, event, condition, channels, webhook_secret
    from notification_rules
    where jurisdiction_id = ${event.jurisdictionId} and enabled
      and event = ${event.event}
      and (board_id is null or board_id = ${event.boardId})
    order by id`;
  void actor;
  let message: Message | null = null;
  for (const rule of rules) {
    const condition = ConditionSchema.parse(rule.condition ?? {});
    if (!matches(condition, event)) continue;
    const channels = z.array(ChannelSchema).parse(rule.channels);
    message ??= await describe(tx, event);
    for (const channel of channels) {
      await enqueue(tx, rule.id as string, rule.webhook_secret as string | null, channel, event, message);
    }
  }
}

/** What people read: the subject or notification title, and the message text. */
interface Message {
  readonly title: string;
  readonly body: string;
}

/**
 * A board event in people's words: the board's title, the record's name, and
 * each field by its label, an enum value by its label. A message leaves the
 * system, so it spells out only fields every reader of the board may see. A
 * board this transaction cannot read is named by its key.
 */
async function describe(tx: Sql, event: BoardEvent): Promise<Message> {
  const [board] = await tx`
    select b.title, b.local_fields, t.definition from boards b
    join board_templates t on t.key = b.template_key and t.version = b.template_version
    where b.id = ${event.boardId}`;
  const fields = board
    ? effectiveFields(BoardTemplateSchema.parse(board.definition), (board.local_fields as FieldDef[] | null) ?? [])
        .fields.filter((field) => field.read === "any")
    : [];
  const text = (field: FieldDef, value: unknown): string | null => {
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number") return String(value);
    // References, files and shapes are ids or geometry, not words.
    if (typeof value !== "string" || value === "" || !["text", "enum", "datetime"].includes(field.type)) return null;
    return field.type === "enum" ? choiceLabel(value) : value;
  };
  const title = (board?.title as string | undefined) ?? event.boardKey;
  const name = fields.filter((field) => field.type === "text")
    .map((field) => text(field, event.record[field.key])).find(Boolean) ?? "a record";
  const heading = event.event === "record.created" ? `New ${title} record: ${name}` : `${title} record updated: ${name}`;
  const lines = fields.flatMap((field) => {
    const now = text(field, event.record[field.key]);
    if (event.event === "record.created") return now === null ? [] : [`${field.label}: ${now}`];
    const before = text(field, event.previous?.[field.key]);
    if (now === before) return [];
    return [`${field.label}: ${now ?? "No value"}${before === null ? "" : ` (was ${before})`}`];
  });
  return { title: heading, body: [heading, ...lines].join("\n") };
}

const SCHEDULED: Message = { title: "Scheduled notification", body: "Scheduled notification" };

async function enqueue(
  tx: Sql,
  ruleId: string,
  webhookSecret: string | null,
  channel: Channel,
  event: BoardEvent,
  message: Message,
): Promise<void> {
  const { title, body: text } = message;
  if (channel.kind === "inapp") {
    const [row] = event.boardKey === "scheduled"
      ? [undefined]
      : await tx`select created_by_position from board_records where id = ${event.recordId}`;
    const positionId = (row?.created_by_position as string | null | undefined) ?? null;
    await log(tx, event, ruleId, "inapp", "delivered", text, { title, positionId });
    return;
  }
  if (channel.kind === "email" || channel.kind === "sms") {
    // One delivery per recipient, so each is capped, retried and receipted on its own.
    const headers = channel.kind === "email" ? { subject: title } : {};
    for (const to of channel.to) {
      await queue(tx, event, ruleId, channel.kind, to, headers, text, { to, title }, text);
    }
    return;
  }
  if (channel.kind === "group" || channel.kind === "position") {
    await enqueueReach(tx, ruleId, channel, event, message);
    return;
  }
  let target: string;
  let headers: Record<string, string>;
  let body: string;
  let detail: Record<string, unknown>;
  if (channel.kind === "webhook") {
    body = JSON.stringify({
      event: event.event,
      board: event.boardKey,
      recordId: event.recordId,
      record: event.record,
      at: new Date().toISOString(),
    });
    target = channel.url;
    headers = {
      "content-type": "application/json",
      "x-openeoc-signature": `sha256=${signWebhookBody(webhookSecret ?? "", body)}`,
    };
    detail = { url: channel.url, title };
  } else {
    // ntfy-pattern self-hosted push: plain POST to the topic URL.
    target = `${channel.url.replace(/\/$/, "")}/${channel.topic}`;
    // A header carries plain ASCII safely; ntfy decodes an RFC 2047 encoded title.
    headers = { title: /^[\x20-\x7e]*$/.test(title) ? title : `=?UTF-8?B?${Buffer.from(title).toString("base64")}?=` };
    body = text;
    detail = { topic: channel.topic, title };
  }
  await queue(tx, event, ruleId, channel.kind, target, headers, body, detail, text);
}

/**
 * A group or position channel: resolve who it reaches now, then give each
 * person an in-app notice, an email and an SMS as the channel asks, each by
 * the address their contact card has. A person with no address for a way is
 * skipped on it. When the channel reaches no one, because the group is empty
 * or gone or the position has no holder, a failed notification says so in the
 * log instead of the rule going quiet.
 */
async function enqueueReach(
  tx: Sql,
  ruleId: string,
  channel: Extract<Channel, { kind: "group" | "position" }>,
  event: BoardEvent,
  message: Message,
): Promise<void> {
  const { title, body: text } = message;
  const via = [...new Set(channel.via)];
  const input = channel.kind === "group" ? { groupIds: [channel.groupId] }
    : channel.reach === "on_call" ? { onCallPositionIds: [channel.positionId] }
    : { positionIds: [channel.positionId] };
  let reached;
  try {
    reached = await resolveAudience(tx, event.jurisdictionId, input);
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    await log(tx, event, ruleId, via[0]!, "failed", text, { title, error: `No one to reach: ${err.message}` });
    return;
  }
  if (reached.recipients.length === 0) {
    const error = `No one to reach: ${audienceLabel(reached.audience, null)}`;
    await log(tx, event, ruleId, via[0]!, "failed", text, { title, error });
    return;
  }
  for (const person of reached.recipients) {
    for (const kind of via) {
      if (kind === "inapp") {
        if (!person.personId && !person.positionId) continue;
        await log(tx, event, ruleId, "inapp", "delivered", text, {
          title,
          personId: person.personId,
          positionId: person.personId ? null : person.positionId,
          reachedThrough: person.through,
        });
        continue;
      }
      const to = kind === "email" ? person.email : person.phone;
      if (!to) continue;
      const headers = kind === "email" ? { subject: title } : {};
      await queue(tx, event, ruleId, kind, to, headers, text, { to, title, reachedThrough: person.through }, text);
    }
  }
}

/**
 * Queue one external delivery with its pending notification, whose text is
 * `note`. Over the rule's cap, nothing is queued and the database counts the
 * suppressed delivery.
 */
async function queue(
  tx: Sql,
  event: BoardEvent,
  ruleId: string,
  kind: "webhook" | "ntfy" | "email" | "sms",
  target: string,
  headers: Record<string, string>,
  body: string,
  detail: Record<string, unknown>,
  note: string,
): Promise<void> {
  const [admitted] = await tx`select admit_rule_delivery(${ruleId}) as ok`;
  if (!admitted!.ok) return;
  const notificationId = await log(tx, event, ruleId, kind, "pending", note, detail);
  await tx`
    insert into delivery_outbox (jurisdiction_id, rule_id, notification_id, kind, target, headers, body)
    values (${event.jurisdictionId}, ${ruleId}, ${notificationId}, ${kind}, ${target},
            ${tx.json(headers as never)}, ${body})`;
}

async function log(
  tx: Sql,
  event: BoardEvent,
  ruleId: string,
  channel: string,
  status: "pending" | "delivered" | "failed",
  body: string,
  detail: Record<string, unknown>,
): Promise<string> {
  const personId = detail.personId as string | null | undefined;
  const positionId = detail.positionId as string | null | undefined;
  // The id is chosen here, not returned: the acting member may write a
  // notification that row-level security does not let them read back.
  const id = randomUUID();
  await tx`
    insert into notifications
      (id, jurisdiction_id, rule_id, person_id, position_id, channel, title, body, status, detail)
    values
      (${id}, ${event.jurisdictionId}, ${ruleId}, ${personId ?? null}, ${positionId ?? null}, ${channel},
       ${(detail.title as string) ?? event.event}, ${body}, ${status},
       ${tx.json(detail as never)})`;
  return id;
}

/**
 * Scheduled rules: fire every configured interval. Called by the runtime
 * timer in deployment and directly by tests; the last-fired guard makes
 * it idempotent within an interval.
 */
export async function runScheduledRules(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  now = new Date(),
): Promise<number> {
  // Claiming the interval and queuing its deliveries commit together, so a
  // crash between them can neither skip an interval nor send it twice.
  return withPerson(sql, actor.person.id, async (tx) => {
    const due = await tx`
      update notification_rules
      set last_fired_at = ${now}
      where jurisdiction_id = ${jurisdictionId} and enabled and event = 'scheduled'
        and schedule_interval_minutes is not null
        and (last_fired_at is null
             or last_fired_at <= ${now}::timestamptz - make_interval(mins => schedule_interval_minutes))
      returning id, channels, webhook_secret`;
    for (const rule of due) {
      const channels = z.array(ChannelSchema).parse(rule.channels);
      const event: BoardEvent = {
        jurisdictionId,
        boardId: rule.id as string,
        boardKey: "scheduled",
        recordId: rule.id as string,
        event: "record.created",
        record: { summary: "scheduled notification" },
      };
      for (const channel of channels) {
        await enqueue(tx, rule.id as string, rule.webhook_secret as string | null, channel, event, SCHEDULED);
      }
    }
    return due.length;
  });
}
