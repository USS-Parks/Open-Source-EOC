import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { ConnectionOptions } from "node:tls";
import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { principalForPerson } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { BlobStore, uploadFile, uploadLimitsFromEnv } from "../files/service.js";
import { channelRefusal, type StoredChannel } from "../notify/channels.js";
import type { QueuedAttachment } from "../notify/outbox.js";
import { renderReport } from "./render.js";

/** The largest report file queued for email; most relays refuse more than 25 MB. */
const MAX_EMAIL_ATTACHMENT_BYTES = 25 * 1024 * 1024;
import { nextRunAt, ReportDefinitionSchema, runReport, ScheduleSchema } from "./service.js";

/**
 * Scheduled reports. The scheduler calls runDueReports on an interval; each
 * due report runs as its owner under row-level security, so the owner's
 * record rules and field visibility shape what is sent. The output goes by
 * email as an attachment through the jurisdiction's SMTP relay, to named
 * addresses and to contacts' first email address, and, when asked, into the
 * jurisdiction's files. Each run is recorded with its row count and outcome,
 * and audited.
 *
 * Email goes through the delivery queue: the rendered file is stored once by
 * its hash and each address gets a pending notification and a queued
 * delivery that carries it, so a relay that cannot be reached is retried
 * until the email hold runs out, like any other message. The run records
 * the emails as queued; their delivery shows under Notifications.
 */

export interface ReportJobOptions {
  /** Where stored reports and queued attachments go; defaults to OPENEOC_DATA_DIR, as the file routes use. */
  readonly store?: BlobStore | undefined;
  /** Unused since email goes through the delivery queue; kept so existing callers still compile. */
  readonly timeoutMs?: number | undefined;
  /** Unused since email goes through the delivery queue, whose worker takes the relay's TLS options. */
  readonly smtpTls?: ConnectionOptions | undefined;
  readonly logger?: Pick<FastifyBaseLogger, "error"> | undefined;
}

let defaultStore: BlobStore | null = null;

/** Run every report due at `now`. Returns how many ran; one report's failure does not stop the rest. */
export async function runDueReports(sql: Sql, now = new Date(), options: ReportJobOptions = {}): Promise<number> {
  const due = await sql`select * from reports_due(${now})`;
  let ran = 0;
  for (const row of due) {
    try {
      if (await runScheduled(sql, row.report_id as string, row.person_id as string, now, options)) ran += 1;
    } catch (err) {
      options.logger?.error({ err, reportId: row.report_id }, "scheduled report failed");
    }
  }
  return ran;
}

async function runScheduled(sql: Sql, reportId: string, ownerId: string, now: Date, options: ReportJobOptions): Promise<boolean> {
  const actor = await principalForPerson(sql, ownerId);
  // Moving the next run forward first claims this one: an overlapping leader finds it no longer due.
  const report = await withPerson(sql, ownerId, async (tx) => {
    const [row] = await tx`
      select id, jurisdiction_id, name, board_id, incident_id, definition, schedule
      from reports where id = ${reportId} and next_run_at <= ${now}
      for update skip locked`;
    if (!row) return null;
    const schedule = ScheduleSchema.parse(row.schedule);
    await tx`update reports set next_run_at = ${nextRunAt(schedule.cadence, now)} where id = ${reportId}`;
    return { row, schedule };
  });
  if (!report) return false;
  const { row, schedule } = report;
  const jurisdictionId = row.jurisdiction_id as string;
  const name = row.name as string;
  const emails: Array<Record<string, unknown>> = [];
  const detail: Record<string, unknown> = { format: schedule.format, emails };
  let rows: number | null = null;
  let delivered = 0;
  let queued = 0;
  let failed = 0;
  try {
    const built = await withPerson(sql, ownerId, async (tx) => {
      const result = await runReport(tx, actor, {
        boardId: row.board_id as string,
        incidentId: (row.incident_id as string | null) ?? null,
        definition: ReportDefinitionSchema.parse(row.definition),
      }, now);
      const contacts = schedule.contactIds.length === 0 ? [] : await tx`
        select name, emails[1] as email from contacts
        where jurisdiction_id = ${jurisdictionId} and active and id = any(${schedule.contactIds}::uuid[])
        order by name`;
      const [channel] = await tx`select public.report_email_channel(${reportId}) as channel`;
      return { result, contacts, channel: (channel?.channel as StoredChannel | null) ?? null };
    });
    rows = built.result.total.count;
    const file = renderReport(built.result, schedule.format, { name, runAs: actor.person.displayName });
    const skipped = built.contacts.filter((c) => !c.email).map((c) => c.name as string);
    if (skipped.length) detail.contactsWithoutEmail = skipped;
    const addresses = [...new Map([...schedule.emails, ...built.contacts.flatMap((c) => (c.email ? [c.email as string] : []))]
      .map((address) => [address.toLowerCase(), address])).values()];
    if (addresses.length > 0) {
      const refused = await channelRefusal("email", built.channel, []);
      const omitted = built.result.omitted.length
        ? `\nLeft out because ${actor.person.displayName} cannot read them: ${built.result.omitted.join(", ")}.\n` : "";
      const body = `${name}\n\n${rows} record${rows === 1 ? "" : "s"} from the board ${built.result.board.title}, `
        + `generated ${now.toISOString()} for ${actor.person.displayName}.\nThe report is attached as ${file.filename}.\n`
        + `${omitted}\nThis report is sent on a schedule set under Reports in Open Source EOC.\n`;
      if (refused) {
        for (const to of addresses) emails.push({ to, error: refused });
        failed += addresses.length;
      } else {
        try {
          const attachment = await storeAttachment(options, file);
          const subject = `Report: ${name}`;
          await withPerson(sql, ownerId, async (tx) => {
            for (const to of addresses) {
              const notificationId = randomUUID();
              await tx`
                insert into notifications (id, jurisdiction_id, channel, title, body, status, detail)
                values (${notificationId}, ${jurisdictionId}, 'email', ${subject}, ${body}, 'pending',
                        ${tx.json({ to, title: subject, reportId } as never)})`;
              await tx`
                insert into delivery_outbox (jurisdiction_id, notification_id, kind, target, headers, body, attachments)
                values (${jurisdictionId}, ${notificationId}, 'email', ${to}, ${tx.json({ subject } as never)},
                        ${body}, ${tx.json([attachment] as never)})`;
              emails.push({ to, queued: true, notificationId });
            }
          });
          queued += addresses.length;
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          for (const to of addresses) emails.push({ to, error });
          failed += addresses.length;
        }
      }
    }
    if (schedule.storeFile) {
      try {
        const store = options.store ?? (defaultStore ??= new BlobStore(process.env.OPENEOC_DATA_DIR ?? "./data/blobs"));
        const stored = await uploadFile(sql, store, actor, {
          jurisdictionId, name: file.filename, contentType: file.contentType, content: Readable.from([Buffer.from(file.content)]),
        }, uploadLimitsFromEnv());
        detail.fileId = stored.id;
        delivered += 1;
      } catch (err) {
        detail.fileError = err instanceof Error ? err.message : String(err);
        failed += 1;
      }
    }
  } catch (err) {
    detail.error = err instanceof Error ? err.message : String(err);
    failed += 1;
  }
  const outcome = failed > 0
    ? delivered + queued > 0 ? "partial" : "failed"
    : queued > 0 ? "queued" : "delivered";
  await withPerson(sql, ownerId, async (tx) => {
    const [run] = await tx`
      insert into report_runs (report_id, jurisdiction_id, run_by, ran_at, row_count, outcome, detail)
      values (${reportId}, ${jurisdictionId}, ${ownerId}, ${now}, ${rows}, ${outcome}, ${tx.json(detail as never)})
      returning id`;
    await recordAudit(tx, actor, {
      jurisdictionId,
      category: "report.ran",
      subjectTable: "reports",
      subjectId: reportId,
      payload: {
        runId: run!.id as string, outcome, rows, format: schedule.format,
        emailsQueued: queued, fileId: detail.fileId ?? null,
      },
    });
  });
  return true;
}

/** Store a rendered report by its hash, once, for the queued emails that carry it. */
async function storeAttachment(
  options: ReportJobOptions,
  file: { readonly filename: string; readonly contentType: string; readonly content: Uint8Array },
): Promise<QueuedAttachment> {
  const store = options.store ?? (defaultStore ??= new BlobStore(process.env.OPENEOC_DATA_DIR ?? "./data/blobs"));
  const staged = await store.stage(Readable.from([Buffer.from(file.content)]), MAX_EMAIL_ATTACHMENT_BYTES);
  await store.commit(staged);
  return { filename: file.filename, contentType: file.contentType, sha256: staged.sha256 };
}
