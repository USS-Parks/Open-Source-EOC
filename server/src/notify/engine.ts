import { createHmac } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import type { Principal } from "../auth/service.js";

/**
 * Notification engine (F4). Rules are data: an event, an optional
 * condition over the record, and a channel list. Delivery is post-commit
 * (never inside the mutating transaction) and every attempt lands as a
 * logged notification row, delivered or failed; a dead channel is a
 * visible record, not a silent drop.
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

export async function notifyBoardEvent(
  sql: Sql,
  actor: Principal,
  event: BoardEvent,
): Promise<void> {
  const rules = await withPerson(sql, actor.person.id, (tx) => {
    return tx`
      select id, board_id, event, condition, channels, webhook_secret
      from notification_rules
      where jurisdiction_id = ${event.jurisdictionId} and enabled
        and event = ${event.event}
        and (board_id is null or board_id = ${event.boardId})`;
  });
  for (const rule of rules) {
    const condition = ConditionSchema.parse(rule.condition ?? {});
    if (!matches(condition, event)) continue;
    const channels = z.array(ChannelSchema).parse(rule.channels);
    for (const channel of channels) {
      await deliver(sql, actor, rule.id as string, rule.webhook_secret as string | null, channel, event);
    }
  }
}

const DELIVERY_TIMEOUT_MS = 5000;

async function deliver(
  sql: Sql,
  actor: Principal,
  ruleId: string,
  webhookSecret: string | null,
  channel: Channel,
  event: BoardEvent,
): Promise<void> {
  const title = `${event.boardKey}: ${event.event}`;
  const bodyText = summarize(event);
  try {
    if (channel.kind === "inapp") {
      const positionId = await requestingPosition(sql, actor, event.recordId);
      await log(sql, actor, event, ruleId, "inapp", "delivered", { title, positionId });
      return;
    }
    if (channel.kind === "webhook") {
      const payload = JSON.stringify({
        event: event.event,
        board: event.boardKey,
        recordId: event.recordId,
        record: event.record,
        at: new Date().toISOString(),
      });
      const signature = signWebhookBody(webhookSecret ?? "", payload);
      const res = await fetch(channel.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openeoc-signature": `sha256=${signature}`,
        },
        body: payload,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`webhook responded ${res.status}`);
      await log(sql, actor, event, ruleId, "webhook", "delivered", { url: channel.url, title });
      return;
    }
    // ntfy-pattern self-hosted push: plain POST to the topic URL.
    const res = await fetch(`${channel.url.replace(/\/$/, "")}/${channel.topic}`, {
      method: "POST",
      headers: { title },
      body: bodyText,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`ntfy responded ${res.status}`);
    await log(sql, actor, event, ruleId, "ntfy", "delivered", { topic: channel.topic, title });
  } catch (err) {
    await log(sql, actor, event, ruleId, channel.kind, "failed", {
      title,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function requestingPosition(
  sql: Sql,
  actor: Principal,
  recordId: string,
): Promise<string | null> {
  const [row] = await withPerson(sql, actor.person.id, (tx) => {
    return tx`select created_by_position from board_records where id = ${recordId}`;
  });
  return (row?.created_by_position as string | null) ?? null;
}

async function log(
  sql: Sql,
  actor: Principal,
  event: BoardEvent,
  ruleId: string,
  channel: string,
  status: "delivered" | "failed",
  detail: Record<string, unknown>,
): Promise<void> {
  const positionId = detail.positionId as string | null | undefined;
  await withPerson(sql, actor.person.id, (tx) => {
    return tx`
      insert into notifications
        (jurisdiction_id, rule_id, position_id, channel, title, body, status, detail)
      values
        (${event.jurisdictionId}, ${ruleId}, ${positionId ?? null}, ${channel},
         ${(detail.title as string) ?? event.event}, ${summarize(event)}, ${status},
         ${tx.json(detail as never)})`;
  });
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
  const due = await withPerson(sql, actor.person.id, (tx) => {
    return tx`
      update notification_rules
      set last_fired_at = ${now}
      where jurisdiction_id = ${jurisdictionId} and enabled and event = 'scheduled'
        and schedule_interval_minutes is not null
        and (last_fired_at is null
             or last_fired_at <= ${now}::timestamptz - make_interval(mins => schedule_interval_minutes))
      returning id, channels, webhook_secret`;
  });
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
      if (channel.kind === "inapp") {
        await log(sql, actor, event, rule.id as string, "inapp", "delivered", {
          title: "scheduled",
        });
      } else {
        await deliver(sql, actor, rule.id as string, rule.webhook_secret as string | null, channel, event);
      }
    }
  }
  return due.length;
}
