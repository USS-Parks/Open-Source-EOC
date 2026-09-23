import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import type { Principal } from "../auth/service.js";
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

export const ChannelSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inapp"), target: z.enum(["requesting_position"]) }),
  z.object({ kind: z.literal("webhook"), url: z.string().url() }),
  z.object({ kind: z.literal("ntfy"), url: z.string().url(), topic: z.string().min(1) }),
  z.object({ kind: z.literal("email"), to: z.array(z.email()).min(1).max(50) }),
  z.object({ kind: z.literal("sms"), to: z.array(E164).min(1).max(50) }),
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
  for (const rule of rules) {
    const condition = ConditionSchema.parse(rule.condition ?? {});
    if (!matches(condition, event)) continue;
    const channels = z.array(ChannelSchema).parse(rule.channels);
    for (const channel of channels) {
      await enqueue(tx, actor, rule.id as string, rule.webhook_secret as string | null, channel, event);
    }
  }
}

async function enqueue(
  tx: Sql,
  actor: Principal,
  ruleId: string,
  webhookSecret: string | null,
  channel: Channel,
  event: BoardEvent,
): Promise<void> {
  void actor;
  const title = `${event.boardKey}: ${event.event}`;
  if (channel.kind === "inapp") {
    const [row] = event.boardKey === "scheduled"
      ? [undefined]
      : await tx`select created_by_position from board_records where id = ${event.recordId}`;
    const positionId = (row?.created_by_position as string | null | undefined) ?? null;
    await log(tx, event, ruleId, "inapp", "delivered", { title, positionId });
    return;
  }
  if (channel.kind === "email" || channel.kind === "sms") {
    // One delivery per recipient, so each is capped, retried and receipted on its own.
    const headers = channel.kind === "email" ? { subject: title } : {};
    for (const to of channel.to) {
      await queue(tx, event, ruleId, channel.kind, to, headers, summarize(event), { to, title });
    }
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
    headers = { title };
    body = summarize(event);
    detail = { topic: channel.topic, title };
  }
  await queue(tx, event, ruleId, channel.kind, target, headers, body, detail);
}

/**
 * Queue one external delivery with its pending notification. Over the rule's
 * cap, nothing is queued and the database counts the suppressed delivery.
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
): Promise<void> {
  const [admitted] = await tx`select admit_rule_delivery(${ruleId}) as ok`;
  if (!admitted!.ok) return;
  const notificationId = await log(tx, event, ruleId, kind, "pending", detail);
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
  status: "pending" | "delivered",
  detail: Record<string, unknown>,
): Promise<string> {
  const positionId = detail.positionId as string | null | undefined;
  // The id is chosen here, not returned: the acting member may write a
  // notification that row-level security does not let them read back.
  const id = randomUUID();
  await tx`
    insert into notifications
      (id, jurisdiction_id, rule_id, position_id, channel, title, body, status, detail)
    values
      (${id}, ${event.jurisdictionId}, ${ruleId}, ${positionId ?? null}, ${channel},
       ${(detail.title as string) ?? event.event}, ${summarize(event)}, ${status},
       ${tx.json(detail as never)})`;
  return id;
}

function summarize(event: BoardEvent): string {
  const summary = event.record.summary ?? event.record.item ?? event.record.name ?? "";
  return `${event.boardKey} ${event.event.replace("record.", "")}: ${String(summary)}`.trim();
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
        await enqueue(tx, actor, rule.id as string, rule.webhook_secret as string | null, channel, event);
      }
    }
    return due.length;
  });
}
