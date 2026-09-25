import {
  componentToFormContent,
  prefill213rr,
  renderIcsFormPdf,
  type ComponentValues,
  type IcsFormContent,
  type ResourceRequestDetail,
  type Rr213Cost,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import type { Principal } from "../auth/service.js";
import { getRequest } from "./service.js";

/**
 * The ICS 213RR of a resource request (Veoci and air gap VA38), rendered
 * from the request through its lifecycle: the requestor's order and the
 * acceptance, the supplier and each step for logistics, and the costs for
 * finance. Costs stay with the owning organization, as the cost table's
 * policy keeps them, so another reader's 213RR has empty finance blocks.
 */

export interface Ics213rr {
  readonly request: ResourceRequestDetail;
  readonly incidentName: string | null;
  readonly values: ComponentValues;
  readonly form: IcsFormContent;
}

const stamp = (at: Date): string => `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** A request's recorded costs, oldest first, with who recorded each. */
export async function requestCosts(sql: Sql, requestId: string): Promise<Rr213Cost[]> {
  const rows = await sql`
    select c.category, c.description, c.amount_cents, c.incurred_at, p.display_name
    from rr_costs c join persons p on p.id = c.recorded_by
    where c.request_id = ${requestId} order by c.created_at, c.id`;
  return rows.map((row) => ({
    category: row.category as string,
    description: row.description as string,
    amountCents: Number(row.amount_cents),
    incurredAt: (row.incurred_at as Date).toISOString().slice(0, 10),
    recordedBy: row.display_name as string,
  }));
}

/** A request's 213RR as it stands now, for reading, printing or starting a period's form. */
export async function ics213rr(sql: Sql, actor: Principal, requestId: string): Promise<Ics213rr> {
  const request = await getRequest(sql, actor, requestId);
  const values = prefill213rr(request, await requestCosts(sql, requestId));
  const [incident] = request.incidentId ? await sql`select name from incidents where id = ${request.incidentId}` : [];
  const incidentName = (incident?.name as string | undefined) ?? null;
  const form = componentToFormContent("ICS-213RR", values, {
    incidentName: incidentName ?? "No incident",
    operationalPeriod: `As of ${stamp(new Date())}`,
    preparedBy: `${actor.person.displayName}, from the request's record`,
    label: `REQ-${request.number}`,
  });
  return { request, incidentName, values, form };
}

/** The 213RR as a PDF, named after the request. */
export async function ics213rrPdf(sql: Sql, actor: Principal, requestId: string): Promise<{ filename: string; bytes: Uint8Array }> {
  const { request, form } = await ics213rr(sql, actor, requestId);
  const bytes = renderIcsFormPdf(form, { source: "Resource request record", sourceTime: request.updatedAt });
  return { filename: `ics-213rr-req-${request.number}.pdf`, bytes };
}
