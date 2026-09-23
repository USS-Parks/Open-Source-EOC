import { Readable } from "node:stream";
import type { ConnectionOptions } from "node:tls";
import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { principalForPerson } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";
import { BlobStore, uploadFile, uploadLimitsFromEnv } from "../files/service.js";
import { EmailSettings, channelRefusal, type StoredChannel } from "../notify/channels.js";
import { sendMail } from "../notify/smtp.js";
import { decryptSecret } from "../secrets/envelope.js";
import { renderReport } from "./render.js";
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
 * Email is sent directly, not through the delivery queue, because the queue
 * carries text bodies only. A send that fails is recorded on the run and is
 * not retried; the next scheduled run sends a fresh report.
 */

export interface ReportJobOptions {
  /** Where stored reports go; defaults to OPENEOC_DATA_DIR, as the file routes use. */
  readonly store?: BlobStore | undefined;
  readonly timeoutMs?: number | undefined;
  /** Extra TLS options for the SMTP relay, such as a private CA. */
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
      const relay = refused ? null : EmailSettings.parse(built.channel!.settings);
      const password = built.channel?.secret && !refused ? decryptSecret(built.channel.secret) : null;
      const omitted = built.result.omitted.length
        ? `\nLeft out because ${actor.person.displayName} cannot read them: ${built.result.omitted.join(", ")}.\n` : "";
      const body = `${name}\n\n${rows} record${rows === 1 ? "" : "s"} from the board ${built.result.board.title}, `
        + `generated ${now.toISOString()} for ${actor.person.displayName}.\nThe report is attached as ${file.filename}.\n`
        + `${omitted}\nThis report is sent on a schedule set under Reports in Open Source EOC.\n`;
      for (const to of addresses) {
        if (!relay) {
          emails.push({ to, error: refused });
          failed += 1;
          continue;
        }
        try {
          const receipt = await sendMail(relay, password, { to, subject: `Report: ${name}`, body, attachments: [file] },
            { timeoutMs: options.timeoutMs ?? 10_000, tls: options.smtpTls });
          emails.push({ to, response: receipt.response, messageId: receipt.messageId });
          delivered += 1;
        } catch (err) {
          emails.push({ to, error: err instanceof Error ? err.message : String(err) });
          failed += 1;
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
  const outcome = failed === 0 ? "delivered" : delivered > 0 ? "partial" : "failed";
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
        emailed: emails.filter((e) => !e.error).length, fileId: detail.fileId ?? null,
      },
    });
  });
  return true;
}
