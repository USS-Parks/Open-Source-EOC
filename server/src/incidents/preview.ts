import type { GrantPreview, PreviewSection } from "@openeoc/shared";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { AuthError, type Principal } from "../auth/service.js";
import { getIncidentAuthority } from "./participation.js";

interface Holdings {
  readonly boards: ReadonlyMap<string, string>;
  readonly records: ReadonlyMap<string, number>;
  readonly requests: ReadonlyMap<string, string>;
  readonly threads: ReadonlyMap<string, string>;
  readonly datasets: ReadonlyMap<string, string>;
}

/** What the current person reads on the incident, under row-level security. */
async function holdings(tx: Sql, incidentId: string): Promise<Holdings> {
  const boards = await tx`
    select b.id, b.title from incident_boards ib join boards b on b.id = ib.board_id
    where ib.incident_id = ${incidentId}`;
  const records = await tx`
    select board_id, count(*)::int as n from board_records
    where incident_id = ${incidentId} and deleted_at is null group by board_id`;
  const requests = await tx`select id, number, item from resource_requests where incident_id = ${incidentId}`;
  const threads = await tx`select id, title from threads where incident_id = ${incidentId}`;
  const datasets = await tx`
    select d.id, d.name from data_pack_datasets d join data_packs p on p.id = d.pack_id
    where p.incident_id = ${incidentId}`;
  return {
    boards: new Map(boards.map((row) => [row.id as string, row.title as string])),
    records: new Map(records.map((row) => [row.board_id as string, Number(row.n)])),
    requests: new Map(requests.map((row) => [row.id as string, `REQ-${row.number as number} ${row.item as string}`])),
    threads: new Map(threads.map((row) => [row.id as string, (row.title as string | null) ?? "Untitled thread"])),
    datasets: new Map(datasets.map((row) => [row.id as string, row.name as string])),
  };
}

function section(key: PreviewSection["key"], label: string, mine: ReadonlyMap<string, string>, theirs: ReadonlyMap<string, string>): PreviewSection {
  return {
    key,
    label,
    readable: [...theirs.values()].sort(),
    restricted: [...mine].filter(([id]) => !theirs.has(id)).map(([, name]) => name).sort(),
  };
}

/**
 * What a participant grant lets its person read on the incident, next to what
 * the reviewing administrator reads. The same reads run twice under row-level
 * security, once as the administrator and once as the grant's person, so the
 * preview is the wall itself rather than a model of it; everything the person
 * cannot read is named. Records are counted per board, since a board may hide
 * some of its records from some readers.
 */
export async function previewParticipantGrant(sql: Sql, actor: Principal, incidentId: string, participantId: string): Promise<GrantPreview> {
  const { mine, grant } = await withPerson(sql, actor.person.id, async (tx) => {
    const authority = await getIncidentAuthority(tx, actor, incidentId);
    if (!authority.canManageParticipation) throw new AuthError(403, "only the incident's administrators preview a grant");
    const [row] = await tx`
      select ip.person_id, ip.role, ip.expires_at, ip.revoked_at, p.display_name, j.name as organization
      from incident_participants ip join persons p on p.id = ip.person_id join jurisdictions j on j.id = ip.organization_id
      where ip.id = ${participantId} and ip.incident_id = ${incidentId}`;
    if (!row) throw new AuthError(404, "participant not found");
    return { mine: await holdings(tx, incidentId), grant: row };
  });
  const theirs = await withPerson(sql, grant.person_id as string, (tx) => holdings(tx, incidentId));
  const recordCount = (from: Holdings) => new Map([...from.boards].map(([id, title]) => [id, `${title}: ${from.records.get(id) ?? 0} records`]));
  const hiddenRecords = [...mine.boards].filter(([id]) => theirs.boards.has(id) && (theirs.records.get(id) ?? 0) < (mine.records.get(id) ?? 0))
    .map(([id, title]) => `${title}: ${(mine.records.get(id) ?? 0) - (theirs.records.get(id) ?? 0)} of ${mine.records.get(id) ?? 0} records`);
  return {
    person: grant.display_name as string,
    organization: grant.organization as string,
    role: grant.role as string,
    expiresAt: new Date(grant.expires_at as string).toISOString(),
    active: !grant.revoked_at && new Date(grant.expires_at as string).getTime() > Date.now(),
    sections: [
      section("boards", "Boards", mine.boards, theirs.boards),
      { key: "records", label: "Records on those boards", readable: [...recordCount(theirs).values()].sort(), restricted: hiddenRecords.sort() },
      section("requests", "Resource requests", mine.requests, theirs.requests),
      section("threads", "Message threads", mine.threads, theirs.threads),
      section("datasets", "Map datasets", mine.datasets, theirs.datasets),
    ],
  };
}
