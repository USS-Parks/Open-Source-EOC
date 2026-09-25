import {
  EquipmentHoursSchema,
  EquipmentRateImportSchema,
  ForceAccountRollUpSchema,
  LaborRateSchema,
  equipmentCost,
  forceAccountTotals,
  laborDay,
  type EquipmentRateView,
  type EquipmentRow,
  type ForceAccountSummary,
  type LaborRate,
  type LaborRateView,
  type LaborRow,
} from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { AuthError, requireAdmin, requireMember, requireWriter, type Principal } from "../auth/service.js";
import { recordAudit } from "../audit/service.js";

/**
 * FEMA Public Assistance force account (VC-10). Labor hours are read from
 * an incident's staff check-ins and shifts, a row per person per local day;
 * equipment hours from the incident's equipment log against pool resources.
 * Each is costed at the jurisdiction's labor rates and equipment schedule,
 * and a summary can be rolled into a Public Assistance line item as its
 * estimated cost, keeping the summary it came from. Wage rates are read and
 * the summary computed for the jurisdiction's administrators and members;
 * administrators set rates and import the schedule.
 */

type Row = Record<string, unknown>;
const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

function validTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    throw new AuthError(400, `timeZone: ${timeZone} is not a time zone`);
  }
}

async function incidentJurisdiction(sql: Sql, incidentId: string): Promise<string> {
  const [incident] = await sql`select jurisdiction_id from incidents where id = ${incidentId}`;
  if (!incident) throw new AuthError(404, "incident not found");
  return incident.jurisdiction_id as string;
}

function toLaborRate(row: Row): LaborRate {
  return {
    jobTitle: row.job_title as string,
    hourlyRate: Number(row.hourly_rate),
    overtimeRate: num(row.overtime_rate),
    fringePercent: Number(row.fringe_percent),
    overtimeFringePercent: num(row.overtime_fringe_percent),
    overtimeAfterHours: Number(row.overtime_after_hours),
  };
}

/** The jurisdiction's labor rates (for administrators and members) and its equipment schedule. */
export async function listRates(sql: Sql, actor: Principal, jurisdictionId: string): Promise<{
  labor: LaborRateView[]; equipment: EquipmentRateView[];
}> {
  requireMember(actor, jurisdictionId);
  let labor: LaborRateView[] = [];
  try {
    requireWriter(actor, jurisdictionId);
    const rows = await sql`
      select r.*, p.display_name from pa_labor_rates r join persons p on p.id = r.person_id
      where r.jurisdiction_id = ${jurisdictionId} order by p.display_name, r.person_id`;
    labor = rows.map((row) => ({ ...toLaborRate(row), personId: row.person_id as string, personName: row.display_name as string }));
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
  }
  const equipment = await sql`
    select code, equipment, manufacturer, specification, capacity, hp, notes, unit, rate, source, edition
    from pa_equipment_rates where jurisdiction_id = ${jurisdictionId} order by code`;
  return {
    labor,
    equipment: equipment.map((row) => ({
      code: row.code as string, equipment: row.equipment as string, manufacturer: row.manufacturer as string,
      specification: row.specification as string, capacity: row.capacity as string, hp: row.hp as string,
      notes: row.notes as string, unit: row.unit as string, rate: Number(row.rate),
      source: row.source as "fema" | "local", edition: row.edition as string,
    })),
  };
}

/** Set one person's labor rate; they must belong to the jurisdiction. */
export async function setLaborRate(
  sql: Sql, actor: Principal, jurisdictionId: string, personId: string, raw: unknown,
): Promise<LaborRateView> {
  requireAdmin(actor, jurisdictionId);
  const rate = LaborRateSchema.parse(raw);
  const [person] = await sql`
    select p.display_name from jurisdiction_memberships m join persons p on p.id = m.person_id
    where m.jurisdiction_id = ${jurisdictionId} and m.person_id = ${personId}`;
  if (!person) throw new AuthError(400, "the person is not a member of this jurisdiction");
  await sql`
    insert into pa_labor_rates (jurisdiction_id, person_id, job_title, hourly_rate, overtime_rate, fringe_percent,
      overtime_fringe_percent, overtime_after_hours, updated_by)
    values (${jurisdictionId}, ${personId}, ${rate.jobTitle}, ${rate.hourlyRate}, ${rate.overtimeRate}, ${rate.fringePercent},
      ${rate.overtimeFringePercent}, ${rate.overtimeAfterHours}, ${actor.person.id})
    on conflict (jurisdiction_id, person_id) do update set
      job_title = excluded.job_title, hourly_rate = excluded.hourly_rate, overtime_rate = excluded.overtime_rate,
      fringe_percent = excluded.fringe_percent, overtime_fringe_percent = excluded.overtime_fringe_percent,
      overtime_after_hours = excluded.overtime_after_hours, updated_by = excluded.updated_by, updated_at = now()`;
  await recordAudit(sql, actor, {
    jurisdictionId, category: "damage.labor_rate.saved", subjectTable: "persons", subjectId: personId,
    payload: { ...rate },
  });
  return { ...rate, personId, personName: person.display_name as string };
}

/**
 * Import equipment rates: each row replaces the jurisdiction's rate of the
 * same code, and is named by the schedule's edition. Rates of other codes
 * stay as they were.
 */
export async function importEquipmentRates(
  sql: Sql, actor: Principal, jurisdictionId: string, raw: unknown,
): Promise<{ inserted: number; updated: number }> {
  requireAdmin(actor, jurisdictionId);
  const input = EquipmentRateImportSchema.parse(raw);
  const codes = input.rows.map((row) => row.code);
  const repeated = codes.find((code, index) => codes.indexOf(code) !== index);
  if (repeated) throw new AuthError(400, `rows: cost code ${repeated} is listed twice`);
  let inserted = 0;
  for (const row of input.rows) {
    const [written] = await sql`
      insert into pa_equipment_rates (jurisdiction_id, code, equipment, manufacturer, specification, capacity, hp, notes,
        unit, rate, source, edition, imported_by)
      values (${jurisdictionId}, ${row.code}, ${row.equipment}, ${row.manufacturer}, ${row.specification}, ${row.capacity},
        ${row.hp}, ${row.notes}, ${row.unit}, ${row.rate}, ${input.source}, ${input.edition}, ${actor.person.id})
      on conflict (jurisdiction_id, code) do update set
        equipment = excluded.equipment, manufacturer = excluded.manufacturer, specification = excluded.specification,
        capacity = excluded.capacity, hp = excluded.hp, notes = excluded.notes, unit = excluded.unit, rate = excluded.rate,
        source = excluded.source, edition = excluded.edition, imported_by = excluded.imported_by, imported_at = now()
      returning (xmax = 0) as inserted`;
    if (written!.inserted) inserted += 1;
  }
  const result = { inserted, updated: input.rows.length - inserted };
  await recordAudit(sql, actor, {
    jurisdictionId, category: "damage.equipment_rates.imported", subjectTable: "jurisdictions", subjectId: jurisdictionId,
    payload: { edition: input.edition, source: input.source, rows: input.rows.length, ...result },
  });
  return result;
}

/** Log equipment use on an incident. A code with no rate yet is kept and shows as unrated. */
export async function recordEquipmentHours(
  sql: Sql, actor: Principal, incidentId: string, raw: unknown,
): Promise<{ id: string }> {
  const jurisdictionId = await incidentJurisdiction(sql, incidentId);
  requireWriter(actor, jurisdictionId);
  const input = EquipmentHoursSchema.parse(raw);
  if (input.resourceId) {
    const [resource] = await sql`select 1 from resources where id = ${input.resourceId} and jurisdiction_id = ${jurisdictionId}`;
    if (!resource) throw new AuthError(400, "resourceId: no pool resource of this jurisdiction");
  }
  if (input.operatorPersonId) {
    const [operator] = await sql`
      select 1 from jurisdiction_memberships where jurisdiction_id = ${jurisdictionId} and person_id = ${input.operatorPersonId}`;
    if (!operator) throw new AuthError(400, "operatorPersonId: the operator is not a member of this jurisdiction");
  }
  const [row] = await sql`
    insert into pa_equipment_hours (jurisdiction_id, incident_id, resource_id, rate_code, operator_person_id, used_on,
      quantity, note, recorded_by)
    values (${jurisdictionId}, ${incidentId}, ${input.resourceId}, ${input.rateCode}, ${input.operatorPersonId},
      ${input.usedOn}, ${input.quantity}, ${input.note}, ${actor.person.id})
    returning id`;
  const id = row!.id as string;
  await recordAudit(sql, actor, {
    jurisdictionId, incidentId, category: "damage.equipment_hours.recorded", subjectTable: "pa_equipment_hours", subjectId: id,
    payload: { resourceId: input.resourceId, rateCode: input.rateCode, usedOn: input.usedOn, quantity: input.quantity },
  });
  return { id };
}

/** Remove a logged use recorded in error; the audit keeps what it was. */
export async function removeEquipmentHours(sql: Sql, actor: Principal, hoursId: string): Promise<void> {
  const [row] = await sql`
    select jurisdiction_id, incident_id, rate_code, used_on, quantity from pa_equipment_hours where id = ${hoursId}`;
  if (!row) throw new AuthError(404, "equipment hours not found");
  const jurisdictionId = row.jurisdiction_id as string;
  requireWriter(actor, jurisdictionId);
  await sql`delete from pa_equipment_hours where id = ${hoursId}`;
  await recordAudit(sql, actor, {
    jurisdictionId, incidentId: row.incident_id as string, category: "damage.equipment_hours.removed",
    subjectTable: "pa_equipment_hours", subjectId: hoursId,
    payload: { rateCode: row.rate_code as string, usedOn: String(row.used_on), quantity: Number(row.quantity) },
  });
}

/**
 * The incident's force account. A person's worked time is each closed
 * check-in on the incident, and each past shift on the incident assigned to
 * them that none of their check-ins overlaps; it is cut at local midnight in
 * `timeZone` and summed per day. A check-in still open is left out until it
 * closes.
 */
export async function forceAccountSummary(
  sql: Sql, actor: Principal, incidentId: string, timeZone: string,
): Promise<ForceAccountSummary> {
  const jurisdictionId = await incidentJurisdiction(sql, incidentId);
  requireWriter(actor, jurisdictionId);
  const zone = validTimeZone(timeZone);
  const days = await sql`
    with spans as (
      select c.person_id, c.checked_in_at as s, c.checked_out_at as e, 'check_in' as source
      from staff_checkins c
      where c.incident_id = ${incidentId} and c.checked_out_at is not null
      union all
      select sh.person_id, sh.starts_at, sh.ends_at, 'shift'
      from shifts sh
      where sh.incident_id = ${incidentId} and sh.person_id is not null and sh.ends_at <= now()
        and not exists (
          select 1 from staff_checkins c
          where c.incident_id = ${incidentId} and c.person_id = sh.person_id
            and c.checked_in_at < sh.ends_at and coalesce(c.checked_out_at, now()) > sh.starts_at)
    ),
    cut as (
      select sp.person_id, sp.source, d::date as day,
        greatest(sp.s, (d::date)::timestamp at time zone ${zone}) as ds,
        least(sp.e, (d::date + 1)::timestamp at time zone ${zone}) as de
      from spans sp,
        generate_series((sp.s at time zone ${zone})::date, (sp.e at time zone ${zone})::date, interval '1 day') d
    )
    select c.person_id, to_char(c.day, 'YYYY-MM-DD') as day, p.display_name,
      sum(extract(epoch from (c.de - c.ds))) / 3600.0 as hours,
      array_agg(distinct c.source order by c.source) as sources
    from cut c join persons p on p.id = c.person_id
    where c.de > c.ds
    group by c.person_id, c.day, p.display_name
    order by c.day, p.display_name, c.person_id`;
  const people = [...new Set(days.map((row) => row.person_id as string))];
  const rates = new Map<string, LaborRate>();
  if (people.length > 0) {
    const rows = await sql`select * from pa_labor_rates where jurisdiction_id = ${jurisdictionId} and person_id = any(${people})`;
    for (const row of rows) rates.set(row.person_id as string, toLaborRate(row));
  }
  const labor: LaborRow[] = days.map((row) => {
    const rate = rates.get(row.person_id as string) ?? null;
    return {
      personId: row.person_id as string,
      personName: row.display_name as string,
      jobTitle: rate?.jobTitle ?? null,
      date: row.day as string,
      sources: row.sources as Array<"check_in" | "shift">,
      ...laborDay(Number(row.hours), rate),
      hourlyRate: rate?.hourlyRate ?? null,
      overtimeRate: rate ? rate.overtimeRate ?? rate.hourlyRate : null,
      fringePercent: rate?.fringePercent ?? null,
      overtimeFringePercent: rate ? rate.overtimeFringePercent ?? rate.fringePercent : null,
    };
  });

  const used = await sql`
    select h.id, h.resource_id, r.name as resource_name, h.rate_code, e.equipment, e.capacity, e.unit, e.rate,
      o.display_name as operator_name, to_char(h.used_on, 'YYYY-MM-DD') as used_on, h.quantity, h.note
    from pa_equipment_hours h
    left join resources r on r.id = h.resource_id
    left join pa_equipment_rates e on e.jurisdiction_id = h.jurisdiction_id and e.code = h.rate_code
    left join persons o on o.id = h.operator_person_id
    where h.incident_id = ${incidentId}
    order by h.used_on, h.recorded_at, h.id`;
  const equipment: EquipmentRow[] = used.map((row) => {
    const rate = num(row.rate);
    const quantity = Number(row.quantity);
    return {
      id: row.id as string,
      resourceId: (row.resource_id as string | null) ?? null,
      resourceName: (row.resource_name as string | null) ?? null,
      code: row.rate_code as string,
      equipment: (row.equipment as string | null) ?? null,
      capacity: (row.capacity as string | null) || null,
      unit: (row.unit as string | null) ?? "hour",
      operatorName: (row.operator_name as string | null) ?? null,
      date: row.used_on as string,
      quantity,
      rate,
      note: row.note as string,
      costCents: equipmentCost(quantity, rate),
    };
  });

  const unratedPeople = new Map<string, string>();
  for (const row of labor) if (row.hourlyRate === null) unratedPeople.set(row.personId, row.personName);
  return {
    incidentId,
    timeZone: zone,
    labor,
    equipment,
    totals: forceAccountTotals(labor, equipment),
    unratedPeople: [...unratedPeople].map(([personId, personName]) => ({ personId, personName })),
    unratedCodes: [...new Set(equipment.filter((row) => row.rate === null).map((row) => row.code))],
  };
}

/**
 * Roll the incident's force account into a Public Assistance line item: its
 * estimated cost becomes the summary's total, and it keeps the summary it
 * came from. Refused while a person or a code has no rate, since the total
 * would leave their hours out.
 */
export async function rollUpForceAccount(
  sql: Sql, actor: Principal, incidentId: string, raw: unknown,
): Promise<{ paItemId: string; summary: ForceAccountSummary }> {
  const input = ForceAccountRollUpSchema.parse(raw);
  const summary = await forceAccountSummary(sql, actor, incidentId, input.timeZone);
  const jurisdictionId = await incidentJurisdiction(sql, incidentId);
  const [item] = await sql`
    select jurisdiction_id, incident_id from damage_pa_items where id = ${input.paItemId} for update`;
  if (!item || item.jurisdiction_id !== jurisdictionId) throw new AuthError(404, "Public Assistance line item not found");
  if (item.incident_id && item.incident_id !== incidentId) {
    throw new AuthError(409, "the line item belongs to another incident");
  }
  const missing = [
    ...summary.unratedPeople.map((person) => `a labor rate for ${person.personName}`),
    ...summary.unratedCodes.map((code) => `a rate for equipment code ${code}`),
  ];
  if (missing.length > 0) throw new AuthError(409, `Set ${missing.join(", ")} before rolling the force account up.`);
  const snapshot = {
    incidentId, timeZone: summary.timeZone, totals: summary.totals,
    laborRows: summary.labor.length, equipmentRows: summary.equipment.length,
  };
  await sql`
    update damage_pa_items set incident_id = ${incidentId}, estimated_cost_cents = ${summary.totals.totalCents},
      force_account = ${sql.json(snapshot as never)}, force_account_at = now(),
      updated_by = ${actor.person.id}, updated_at = now()
    where id = ${input.paItemId}`;
  await recordAudit(sql, actor, {
    jurisdictionId, incidentId, category: "damage.pa_item.force_account", subjectTable: "damage_pa_items",
    subjectId: input.paItemId, payload: snapshot,
  });
  return { paItemId: input.paItemId, summary };
}
