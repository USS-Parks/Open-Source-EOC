import { randomUUID } from "node:crypto";
import {
  addressedTo,
  distributionFromXml,
  distributionToXml,
  resourceRequestToRm,
  rmToResourceRequest,
  DistributionSchema,
  type ResourceRequest,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, requireWriter, type Principal } from "../auth/service.js";
import { createRecord, getEffectiveBoard } from "../boards/service.js";
import { recordAudit } from "../audit/service.js";

/**
 * EDXL bridge. Emit a 213RR board record as an EDXL-DE envelope
 * carrying an EDXL-RM message, and import such an envelope onto another
 * instance's resource-request board, honoring the envelope's explicit
 * addressing. A request can thus leave and re-enter the platform as a
 * standard message with no loss.
 */

export class EdxlError extends Error {}

async function jurisdictionSlug(sql: Sql, jurisdictionId: string): Promise<string> {
  const [row] = await sql`select slug from jurisdictions where id = ${jurisdictionId}`;
  if (!row) throw new AuthError(404, "jurisdiction not found");
  return row.slug as string;
}

/** Emit a resource-request record as EDXL-DE (+RM) XML. */
export async function emitResourceRequest(
  sql: Sql,
  actor: Principal,
  boardId: string,
  recordId: string,
  recipients: readonly string[] = [],
): Promise<{ xml: string; distributionID: string }> {
  const board = await getEffectiveBoard(sql, actor, boardId);
  if (board.template.key !== "resource_request")
    throw new EdxlError("not a resource-request board");
  const [record] = await sql`
    select data from board_records where id = ${recordId} and board_id = ${boardId}`;
  if (!record) throw new AuthError(404, "record not found");
  const data = record.data as Record<string, unknown>;
  const rr: ResourceRequest = {
    item: String(data.item ?? ""),
    quantity: Number(data.quantity ?? 0),
    priority: data.priority as string | undefined,
    state: data.state as string | undefined,
    needed_by: data.needed_by as string | undefined,
    notes: data.notes as string | undefined,
  };
  const sender = await jurisdictionSlug(sql, board.jurisdictionId);
  const now = new Date().toISOString();
  const distributionID = `DE-${randomUUID()}`;
  const de = DistributionSchema.parse({
    distributionID,
    senderID: sender,
    dateTimeSent: now,
    distributionStatus: "Actual",
    distributionType: "Request",
    combinedConfidentiality: "Unclassified",
    ...(recipients.length
      ? {
          explicitAddress: recipients.map((r) => ({
            explicitAddressScheme: "openeoc",
            explicitAddressValue: r,
          })),
        }
      : {}),
    content: resourceRequestToRm(rr, { messageID: `MSG-${randomUUID()}`, sentDateTime: now }),
  });
  await recordAudit(sql, actor, {
    jurisdictionId: board.jurisdictionId,
    category: "edxl.emitted",
    subjectTable: "board_records",
    subjectId: recordId,
    payload: { distributionID, recipients },
  });
  return { xml: distributionToXml(de), distributionID };
}

/** Import an EDXL-DE envelope onto a jurisdiction's resource-request board. */
export async function importResourceRequest(
  sql: Sql,
  actor: Principal,
  jurisdictionId: string,
  xml: string,
): Promise<{ recordId: string }> {
  requireWriter(actor, jurisdictionId);
  let de;
  try {
    de = distributionFromXml(xml);
  } catch (err) {
    throw new EdxlError(err instanceof Error ? err.message : "unparseable EDXL");
  }
  const slug = await jurisdictionSlug(sql, jurisdictionId);
  if (!addressedTo(de, slug))
    throw new AuthError(403, "envelope is not addressed to this jurisdiction");
  const rr = rmToResourceRequest(de.content);
  const [board] = await sql`
    select id from boards
    where jurisdiction_id = ${jurisdictionId} and template_key = 'resource_request'
      and archived_at is null
    order by created_at limit 1`;
  if (!board) throw new EdxlError("jurisdiction has no resource-request board");
  const data = cleanRecord(rr);
  const result = await createRecord(sql, actor, board.id as string, data);
  await recordAudit(sql, actor, {
    jurisdictionId,
    category: "edxl.imported",
    subjectTable: "board_records",
    subjectId: result.id,
    payload: { distributionID: de.distributionID, senderID: de.senderID },
  });
  return { recordId: result.id };
}

/** Only the fields the resource_request board defines, undefined dropped. */
function cleanRecord(rr: ResourceRequest): Record<string, unknown> {
  const out: Record<string, unknown> = { item: rr.item, quantity: rr.quantity };
  if (rr.priority !== undefined) out.priority = rr.priority;
  if (rr.state !== undefined) out.state = rr.state;
  if (rr.needed_by !== undefined) out.needed_by = rr.needed_by;
  if (rr.notes !== undefined) out.notes = rr.notes;
  return out;
}
