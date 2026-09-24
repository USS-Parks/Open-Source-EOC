import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { selectedImpactEvidenceFields } from "../lifelines/service.js";
import { withPerson } from "../db/context.js";
import { freshDb, type Sql } from "./helpers.js";

let admin: Sql, runtime: Sql, app: FastifyInstance;
let ownerId: string, partnerId: string, outsiderId: string, targetId: string;
let adminPersonId: string, memberPersonId: string, partnerPersonId: string;
let outsiderPersonId: string, targetPersonId: string;
let adminToken: string, memberToken: string, partnerToken: string, outsiderToken: string;
let incidentId: string, otherIncidentId: string, closedIncidentId: string;
let participantId: string, targetParticipantId: string, otherIncidentParticipantId: string;
let otherResourceId: string, legacyLifelineId: string, legacyEsfId: string;
let preexistingEsfIncidentId: string, preexistingEsfRecordId: string;


const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const lifelineUrl = () => `/api/v1/incidents/${incidentId}/lifeline-assessments`;
const esfUrl = () => `/api/v1/incidents/${incidentId}/esf-assessments`;

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST", url: "/api/v1/auth/login", payload: { email, password },
  });
  expect(response.statusCode).toBe(200);
  return response.json().accessToken as string;
}

async function activate(name: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${ownerId}/incidents`,
    headers: auth(adminToken),
    payload: { templateKey: "daily_ops", name },
  });
  expect(response.statusCode).toBe(201);
  return response.json().incidentId as string;
}

async function attachLegacyBoard(
  templateKey: "lifelines" | "esf_status", data: Record<string, unknown>,
): Promise<string> {
  const [board] = await admin`
    insert into boards (jurisdiction_id, template_key, template_version, title)
    values (${ownerId}, ${templateKey}, 1, ${`Legacy ${templateKey}`}) returning id`;
  const boardId = board!.id as string;
  await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${boardId})`;
  const [record] = await admin`
    insert into board_records (board_id, incident_id, data, created_by)
    values (${boardId}, ${incidentId}, ${admin.json(data as never)}, ${memberPersonId}) returning id`;
  return record!.id as string;
}

async function preparePreexistingEsfBackfill(): Promise<void> {
  const [stored] = await admin`
    select definition from board_templates where key = 'esf_status' and version = 1`;
  const definition = stored!.definition as {
    fields: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  const restricted = {
    ...definition,
    version: 2,
    fields: definition.fields.map((field) =>
      field.key === "status" || field.key === "note" ? { ...field, read: "admin" } : field),
  };
  await admin`
    insert into board_templates (key, version, title, definition)
    values ('esf_status', 2, 'Restricted pre-migration ESF',
      ${admin.json(restricted as never)})`;
  const [incident] = await admin`
    insert into incidents (jurisdiction_id, template_key, name, kind, activated_by)
    values (${ownerId}, 'daily_ops', 'Pre-migration ESF', 'incident', ${adminPersonId})
    returning id`;
  preexistingEsfIncidentId = incident!.id as string;
  const [board] = await admin`
    insert into boards (jurisdiction_id, template_key, template_version, title)
    values (${ownerId}, 'esf_status', 2, 'Pre-migration ESF status') returning id`;
  await admin`
    insert into incident_boards (incident_id, board_id)
    values (${preexistingEsfIncidentId}, ${board!.id as string})`;
  const legacyAssessedAt = new Date("2026-08-01T12:34:56.000Z");
  await admin`alter table board_records disable trigger board_records_operational_assessment`;
  try {
    const [record] = await admin`
      insert into board_records
        (board_id, incident_id, data, created_by, created_at)
      values (${board!.id as string}, ${preexistingEsfIncidentId},
        ${admin.json({
          esf: "esf_12_energy",
          status: "stressed",
          note: "Pre-migration restricted ESF note",
        } as never)}, ${memberPersonId}, ${legacyAssessedAt})
      returning id`;
    preexistingEsfRecordId = record!.id as string;
  } finally {
    await admin`alter table board_records enable trigger board_records_operational_assessment`;
  }
  // A legacy-shaped assessment row, as a database carrying board records from
  // before the assessment tables existed would hold after its backfill. The
  // backfill itself was a one-time migration and is gone with the pre-release
  // migration squash, but the columns it wrote and the redaction the read path
  // applies to them still ship, which is what the assertions below cover. The
  // values mirror what that backfill produced for an esf_status record: no
  // condition, unknown activation and capacity, the board status preserved as
  // legacy_status, and the note carried as situation rather than as an
  // impact statement.
  await admin`
    insert into operational_assessments (
      domain, jurisdiction_id, incident_id, framework, definition_key,
      definition_version, activation, capacity, legacy_status, payload,
      assessed_at, source_kind, legacy_board_id, legacy_record_id, created_by,
      home_organization_id, created_at
    )
    values (
      'esf', ${ownerId}, ${preexistingEsfIncidentId}, 'federal', 'esf_12_energy',
      1, 'unknown', 'unknown', 'stressed',
      ${admin.json({
        legacyData: {
          esf: "esf_12_energy",
          status: "stressed",
          note: "Pre-migration restricted ESF note",
        },
        situation: "Pre-migration restricted ESF note",
      } as never)},
      ${legacyAssessedAt}, 'legacy_board', ${board!.id as string},
      ${preexistingEsfRecordId}, ${memberPersonId}, ${ownerId}, ${legacyAssessedAt}
    )`;
}

const lifelinePayload = (condition: string, extra: Record<string, unknown> = {}) => ({
  lifeline: "energy",
  condition,
  assessedAt: new Date().toISOString(),
  confidence: "confirmed",
  impactStatement: `Energy is ${condition}.`,
  ...extra,
});

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  ownerId = await createJurisdiction(admin, "assessment-owner", "Assessment Owner EOC");
  partnerId = await createJurisdiction(admin, "assessment-partner", "Assessment Partner");
  outsiderId = await createJurisdiction(admin, "assessment-outside", "Assessment Outsider");
  targetId = await createJurisdiction(admin, "assessment-target", "Assessment Target");
  adminPersonId = await createPerson(admin, {
    email: "assessment-admin@example.org", displayName: "Assessment Admin",
    password: "assessment-admin-password",
  });
  memberPersonId = await createPerson(admin, {
    email: "assessment-member@example.org", displayName: "Assessment Member",
    password: "assessment-member-password",
  });
  partnerPersonId = await createPerson(admin, {
    email: "assessment-partner@example.org", displayName: "Assessment Partner",
    password: "assessment-partner-password",
  });
  outsiderPersonId = await createPerson(admin, {
    email: "assessment-outsider@example.org", displayName: "Assessment Outsider",
    password: "assessment-outsider-password",
  });
  targetPersonId = await createPerson(admin, {
    email: "assessment-target@example.org", displayName: "Assessment Target",
    password: "assessment-target-password",
  });
  await addMembership(admin, adminPersonId, ownerId, "admin");
  await addMembership(admin, memberPersonId, ownerId, "member");
  await addMembership(admin, partnerPersonId, partnerId, "member");
  await addMembership(admin, outsiderPersonId, outsiderId, "admin");
  await addMembership(admin, targetPersonId, targetId, "member");
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  await preparePreexistingEsfBackfill();
  app = buildApp(runtime, { oidc: null });
  adminToken = await login("assessment-admin@example.org", "assessment-admin-password");
  memberToken = await login("assessment-member@example.org", "assessment-member-password");
  partnerToken = await login("assessment-partner@example.org", "assessment-partner-password");
  outsiderToken = await login("assessment-outsider@example.org", "assessment-outsider-password");
  incidentId = await activate("Assessment Alpha");
  otherIncidentId = await activate("Assessment Other");
  closedIncidentId = await activate("Assessment Closed");
  await admin`update incidents set closed_at = now() where id = ${closedIncidentId}`;
  const grant = await app.inject({
    method: "POST",
    url: `/api/v1/incidents/${incidentId}/participants`,
    headers: auth(adminToken),
    payload: {
      organizationSlug: "assessment-partner",
      personEmail: "assessment-partner@example.org",
      incidentPositionTitle: "Infrastructure Coordinator",
      role: "coordinator",
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      reason: "Independent infrastructure assessment",
    },
  });
  expect(grant.statusCode).toBe(201);
  participantId = grant.json().participant.id as string;
  const targetGrant = await app.inject({
    method: "POST",
    url: `/api/v1/incidents/${incidentId}/participants`,
    headers: auth(adminToken),
    payload: {
      organizationSlug: "assessment-target",
      personEmail: "assessment-target@example.org",
      incidentPositionTitle: "Field Infrastructure Lead",
      role: "contributor",
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      reason: "Cross-organization stabilization assignment",
    },
  });
  expect(targetGrant.statusCode).toBe(201);
  targetParticipantId = targetGrant.json().participant.id as string;
  const otherIncidentGrant = await app.inject({
    method: "POST",
    url: `/api/v1/incidents/${otherIncidentId}/participants`,
    headers: auth(adminToken),
    payload: {
      organizationSlug: "assessment-target",
      personEmail: "assessment-target@example.org",
      incidentPositionTitle: "Other Incident Lead",
      role: "contributor",
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      reason: "Separate incident assignment boundary",
    },
  });
  expect(otherIncidentGrant.statusCode).toBe(201);
  otherIncidentParticipantId = otherIncidentGrant.json().participant.id as string;
  await admin`
    insert into incident_area_revisions (incident_id, revision, geometry, reason, created_by)
    values (${incidentId}, 1,
      ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326),
      'Assessment evidence boundary', ${adminPersonId})`;
  const [resource] = await admin`
    insert into resource_requests
      (jurisdiction_id, incident_id, origin, item, requested_by)
    values (${ownerId}, ${otherIncidentId}, 'eoc', 'Foreign generator', ${adminPersonId}) returning id`;
  otherResourceId = resource!.id as string;
  legacyLifelineId = await attachLegacyBoard("lifelines", {
    lifeline: "energy", status: "unstable", note: "Legacy utility report",
  });
  legacyEsfId = await attachLegacyBoard("esf_status", {
    esf: "esf_12_energy", status: "normal", note: "Legacy ESF report",
  });
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

describe("operational assessments", () => {
  it("backfills a preexisting restricted ESF without leaking its note", async () => {
    const url = `/api/v1/incidents/${preexistingEsfIncidentId}/esf-assessments`;
    const adminView = await app.inject({ method: "GET", url, headers: auth(adminToken) });
    expect(adminView.statusCode).toBe(200);
    const adminReport = adminView.json().states[0].reports[0];
    expect(adminReport).toMatchObject({
      legacyRecordId: preexistingEsfRecordId,
      activation: "unknown",
      capacity: "unknown",
      legacyStatus: "stressed",
      assessedAt: "2026-08-01T12:34:56.000Z",
      payload: { situation: "Pre-migration restricted ESF note" },
      attribution: {
        personId: memberPersonId,
        personName: "Assessment Member",
        recordedAt: "2026-08-01T12:34:56.000Z",
      },
    });
    expect(adminReport.payload).not.toHaveProperty("impactStatement");

    const memberView = await app.inject({ method: "GET", url, headers: auth(memberToken) });
    expect(memberView.statusCode).toBe(200);
    const memberReport = memberView.json().states[0].reports[0];
    expect(memberReport).toMatchObject({
      legacyRecordId: preexistingEsfRecordId,
      legacyStatus: null,
      payload: { situation: null },
      attribution: { personId: memberPersonId, recordedAt: "2026-08-01T12:34:56.000Z" },
    });
    expect(JSON.stringify(memberReport)).not.toContain("Pre-migration restricted ESF note");
    expect(memberReport.payload).not.toHaveProperty("impactStatement");
  });

  it("preserves explicit-source unknowns instead of borrowing category values", () => {
    expect(selectedImpactEvidenceFields(
      { value: 42, coverage: "partial", reason: "combined category is incomparable" },
      {
        datasetId: "00000000-0000-4000-8000-000000000001",
        value: null,
        coverage: "unknown",
        reason: null,
        loadedAt: null,
        sourceVintage: null,
      },
    )).toEqual({
      datasetId: "00000000-0000-4000-8000-000000000001",
      value: null,
      coverage: "unknown",
      reason: null,
      loadedAt: null,
      sourceVintage: null,
    });
  });

  it("preserves legacy attribution and raw ESF status without inferring activation", async () => {
    const lifelines = await app.inject({ method: "GET", url: lifelineUrl(), headers: auth(memberToken) });
    expect(lifelines.statusCode).toBe(200);
    const legacy = lifelines.json().states.find(
      (state: { lifeline: string }) => state.lifeline === "energy",
    ).reports.find((report: { legacyRecordId: string }) => report.legacyRecordId === legacyLifelineId);
    expect(legacy).toMatchObject({
      condition: "unstable",
      sourceKind: "legacy_board",
      attribution: { personId: memberPersonId, personName: "Assessment Member" },
    });

    const esfs = await app.inject({ method: "GET", url: esfUrl(), headers: auth(memberToken) });
    expect(esfs.statusCode).toBe(200);
    const esfLegacy = esfs.json().states[0].reports.find(
      (report: { legacyRecordId: string }) => report.legacyRecordId === legacyEsfId,
    );
    expect(esfLegacy).toMatchObject({
      activation: "unknown", capacity: "unknown", legacyStatus: "normal",
    });
    expect(esfs.json().doctrineGaps.join(" ")).toContain("effective dates");
    expect(esfs.json().doctrineGaps.join(" ")).not.toContain("federal-to-California");
  });

  it("keeps conflicting lifeline reports visible and records an attributed decision", async () => {
    const ownerReport = await app.inject({
      method: "POST", url: lifelineUrl(), headers: auth(memberToken),
      payload: lifelinePayload("stable", {
        evidence: [{ kind: "impact", category: "population", areaRevision: 1 }],
      }),
    });
    expect(ownerReport.statusCode).toBe(201);
    expect(ownerReport.json()).toMatchObject({ condition: "stable" });
    expect(ownerReport.json().payload.evidence[0]).toMatchObject({
      kind: "impact", areaRevision: 1, value: null,
      interpretation: "exposure evidence only; it does not determine lifeline condition",
    });
    const partnerReport = await app.inject({
      method: "POST", url: lifelineUrl(), headers: auth(partnerToken),
      payload: lifelinePayload("stabilizing"),
    });
    expect(partnerReport.statusCode).toBe(201);

    const current = await app.inject({ method: "GET", url: lifelineUrl(), headers: auth(partnerToken) });
    const energy = current.json().states.find(
      (state: { lifeline: string }) => state.lifeline === "energy",
    );
    expect(energy.conflict).toBe(true);
    expect(new Set(energy.reports.map((report: { condition: string }) => report.condition))).toEqual(
      new Set(["unstable", "stable", "stabilizing"]),
    );

    const decided = await app.inject({
      method: "POST",
      url: `${lifelineUrl()}/energy/decisions`,
      headers: auth(adminToken),
      payload: { selectedAssessmentId: ownerReport.json().id, rationale: "Utility evidence confirmed." },
    });
    expect(decided.statusCode).toBe(201);
    const after = await app.inject({ method: "GET", url: lifelineUrl(), headers: auth(memberToken) });
    const decidedEnergy = after.json().states.find(
      (state: { lifeline: string }) => state.lifeline === "energy",
    );
    expect(decidedEnergy).toMatchObject({ condition: "stable", conflict: true });
    expect(decidedEnergy.decision).toMatchObject({
      selectedAssessmentId: ownerReport.json().id,
      attribution: { personId: adminPersonId },
    });
    expect(decidedEnergy.reports).toHaveLength(3);

    const replacement = await app.inject({
      method: "POST", url: lifelineUrl(), headers: auth(memberToken),
      payload: lifelinePayload("stable", { supersedesAssessmentId: ownerReport.json().id }),
    });
    expect(replacement.statusCode).toBe(201);
    const superseded = await app.inject({
      method: "GET", url: lifelineUrl(), headers: auth(memberToken),
    });
    const supersededEnergy = superseded.json().states.find(
      (state: { lifeline: string }) => state.lifeline === "energy",
    );
    expect(supersededEnergy.decision).toBeNull();
    expect(supersededEnergy.reports.map((report: { id: string }) => report.id)).toContain(
      replacement.json().id,
    );
    expect(supersededEnergy.reports.map((report: { id: string }) => report.id)).not.toContain(
      ownerReport.json().id,
    );
  });

  it("records a stabilization objective and the next update time, and refuses an update due before the assessment", async () => {
    const assessedAt = "2026-09-23T16:35:00.000Z";
    const created = await app.inject({
      method: "POST", url: lifelineUrl(), headers: auth(memberToken),
      payload: lifelinePayload("unstable", {
        lifeline: "water_systems",
        assessedAt,
        stabilizationObjective: "Restore treatment to grid power.",
        nextUpdateAt: "2026-09-23T17:30:00-07:00",
      }),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      stabilizationObjective: "Restore treatment to grid power.",
      nextUpdateAt: "2026-09-24T00:30:00.000Z",
    });
    const [row] = await admin`
      select stabilization_objective, next_update_at from operational_assessments where id = ${created.json().id as string}`;
    expect(row).toMatchObject({ stabilization_objective: "Restore treatment to grid power." });
    expect(new Date(row!.next_update_at as string).toISOString()).toBe("2026-09-24T00:30:00.000Z");

    const current = await app.inject({ method: "GET", url: lifelineUrl(), headers: auth(partnerToken) });
    const water = current.json().states.find((state: { lifeline: string }) => state.lifeline === "water_systems");
    expect(water.reports[0]).toMatchObject({ stabilizationObjective: "Restore treatment to grid power." });
    const history = await app.inject({ method: "GET", url: `${lifelineUrl()}/water_systems/history`, headers: auth(memberToken) });
    expect(history.json().reports[0]).toMatchObject({ nextUpdateAt: "2026-09-24T00:30:00.000Z" });

    const early = await app.inject({
      method: "POST", url: lifelineUrl(), headers: auth(memberToken),
      payload: lifelinePayload("unstable", { lifeline: "water_systems", assessedAt, nextUpdateAt: "2026-09-23T16:00:00.000Z" }),
    });
    expect(early.statusCode).toBe(400);
    await expect(admin`
      insert into operational_assessments
        (domain, jurisdiction_id, incident_id, framework, definition_key, definition_version,
         condition, payload, assessed_at, source_kind, created_by, home_organization_id, next_update_at)
      values ('lifeline', ${ownerId}, ${incidentId}, 'fema_community_lifelines', 'water_systems', 1,
        'unstable', '{}'::jsonb, ${assessedAt}, 'native', ${memberPersonId}, ${ownerId}, ${"2026-09-23T16:00:00.000Z"})
    `).rejects.toThrow(/next_update_after_assessment/);
  });

  it("keeps ESF activation and capacity independent and reuses normalized assignment", async () => {
    const created = await app.inject({
      method: "POST", url: esfUrl(), headers: auth(adminToken),
      payload: {
        identity: { framework: "federal", esf: "esf_12_energy" },
        activation: "not_activated",
        capacity: "critical",
        assessedAt: new Date().toISOString(),
        confidence: "confirmed",
        situation: "Staffing capacity was assessed before activation.",
        relatedLifelines: ["energy"],
        actions: [{
          key: "prepare_mutual_aid",
          title: "Prepare mutual aid",
          status: "planned",
          dueAt: new Date(Date.now() + 60_000).toISOString(),
          assignment: {
            kind: "incident_participant", incidentId, participantId,
          },
        }],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ activation: "not_activated", capacity: "critical" });
    expect(created.json().payload.actions[0].assignment).toMatchObject({
      kind: "incident_participant",
      participantId,
      incidentId,
      organizationId: partnerId,
      authority: "incident_owner_admin",
    });
  });

  it("uses an external coordinator's home organization for bounded participant assignment", async () => {
    const created = await app.inject({
      method: "POST", url: lifelineUrl(), headers: auth(partnerToken),
      payload: lifelinePayload("stabilizing", {
        actions: [{
          key: "coordinate_field_team",
          title: "Coordinate outside field team",
          status: "planned",
          assignment: {
            kind: "incident_participant", incidentId, participantId: targetParticipantId,
          },
        }],
      }),
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      attribution: {
        participationId: participantId,
        homeOrganizationId: partnerId,
      },
      payload: {
        actions: [{
          assignment: {
            kind: "incident_participant",
            participantId: targetParticipantId,
            organizationId: targetId,
            authority: "incident_coordinator",
            actorParticipationId: participantId,
          },
        }],
      },
    });
    const [stored] = await admin`
      select payload from operational_assessments where id = ${created.json().id as string}`;
    expect((stored!.payload as { actions: Array<Record<string, unknown>> }).actions[0]).toMatchObject({
      assignment: {
        participantId: targetParticipantId,
        organizationId: targetId,
        authority: "incident_coordinator",
        actorParticipationId: participantId,
      },
    });

    const outsideIncident = await app.inject({
      method: "POST", url: lifelineUrl(), headers: auth(partnerToken),
      payload: lifelinePayload("stabilizing", {
        actions: [{
          key: "outside_incident_target",
          title: "Invalid outside-incident target",
          status: "planned",
          assignment: {
            kind: "incident_participant", incidentId, participantId: otherIncidentParticipantId,
          },
        }],
      }),
    });
    expect(outsideIncident.statusCode).toBe(404);
    expect(outsideIncident.json().error).toContain("active incident participant");

    const sameOrganization = await app.inject({
      method: "POST", url: lifelineUrl(), headers: auth(partnerToken),
      payload: lifelinePayload("stabilizing", {
        actions: [{
          key: "same_organization_target",
          title: "Invalid same-organization target",
          status: "planned",
          assignment: {
            kind: "incident_participant", incidentId, participantId,
          },
        }],
      }),
    });
    expect(sameOrganization.statusCode).toBe(400);
    expect(sameOrganization.json().error).toContain("another organization");
  });

  it("applies legacy board field-read masks without discarding preserved history", async () => {
    for (const templateKey of ["lifelines", "esf_status"] as const) {
      const restrictedVersion = templateKey === "lifelines" ? 2 : 3;
      const [stored] = await admin`
        select definition from board_templates where key = ${templateKey} and version = 1`;
      const definition = stored!.definition as {
        fields: Array<Record<string, unknown>>;
        [key: string]: unknown;
      };
      const restricted = {
        ...definition,
        version: restrictedVersion,
        fields: definition.fields.map((field) =>
          field.key === "status" || field.key === "note" ? { ...field, read: "admin" } : field),
      };
      await admin`
        insert into board_templates (key, version, title, definition)
        values (${templateKey}, ${restrictedVersion}, ${`Restricted ${templateKey}`},
          ${admin.json(restricted as never)})`;
      await admin`
        update boards set template_version = ${restrictedVersion} where id = (
          select board_id from board_records
          where id = ${templateKey === "lifelines" ? legacyLifelineId : legacyEsfId})`;
    }
    const memberLifelines = await app.inject({
      method: "GET", url: lifelineUrl(), headers: auth(memberToken),
    });
    const legacy = memberLifelines.json().states.find(
      (state: { lifeline: string }) => state.lifeline === "energy",
    ).reports.find((report: { legacyRecordId: string }) => report.legacyRecordId === legacyLifelineId);
    expect(legacy).toMatchObject({ condition: "unknown", payload: { impactStatement: null } });
    expect(JSON.stringify(legacy)).not.toContain("Legacy utility report");

    const memberEsfs = await app.inject({ method: "GET", url: esfUrl(), headers: auth(memberToken) });
    const legacyEsf = memberEsfs.json().states.find(
      (state: { esf: string }) => state.esf === "esf_12_energy",
    ).reports.find((report: { legacyRecordId: string }) => report.legacyRecordId === legacyEsfId);
    expect(legacyEsf).toMatchObject({ legacyStatus: null, payload: { situation: null } });
    expect(JSON.stringify(legacyEsf)).not.toContain("Legacy ESF report");

    const adminView = await app.inject({ method: "GET", url: lifelineUrl(), headers: auth(adminToken) });
    expect(JSON.stringify(adminView.json())).toContain("Legacy utility report");
  });

  it("rejects unrelated, closed, revoked, and cross-incident writes", async () => {
    expect((await app.inject({
      method: "GET", url: lifelineUrl(), headers: auth(outsiderToken),
    })).statusCode).toBe(404);
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${closedIncidentId}/lifeline-assessments`,
      headers: auth(memberToken), payload: lifelinePayload("unknown"),
    })).statusCode).toBe(409);
    const foreign = await app.inject({
      method: "POST", url: lifelineUrl(), headers: auth(memberToken),
      payload: lifelinePayload("stable", {
        actions: [{
          key: "foreign_link", title: "Foreign link", status: "planned",
          linkedResourceRequestId: otherResourceId,
        }],
      }),
    });
    expect(foreign.statusCode).toBe(400);
    const foreignAssignment = await app.inject({
      method: "POST", url: lifelineUrl(), headers: auth(adminToken),
      payload: lifelinePayload("stable", {
        actions: [{
          key: "foreign_assignment", title: "Foreign assignment", status: "planned",
          assignment: {
            kind: "incident_participant", incidentId: otherIncidentId, participantId,
          },
        }],
      }),
    });
    expect(foreignAssignment.statusCode).toBe(400);
    expect(foreignAssignment.json().error).toContain("another incident");

    await withPerson(runtime, partnerPersonId, (tx) => tx`
      update board_records
      set data = jsonb_set(data, '{note}', '"Partner current report"'::jsonb),
        updated_by = ${partnerPersonId}, updated_at = now()
      where id = ${legacyLifelineId}`);
    const [partnerCapture] = await admin`
      select id, created_by, position_id, position_title, participation_id,
        home_organization_id, payload
      from operational_assessments
      where legacy_record_id = ${legacyLifelineId} and created_by = ${partnerPersonId}
      order by created_at desc, id desc limit 1`;
    expect(partnerCapture).toMatchObject({
      created_by: partnerPersonId,
      position_id: null,
      position_title: "Infrastructure Coordinator",
      participation_id: participantId,
      home_organization_id: partnerId,
    });

    await expect(withPerson(runtime, memberPersonId, (tx) => tx`
      update board_records set incident_id = ${otherIncidentId},
        updated_by = ${memberPersonId}, updated_at = now()
      where id = ${legacyLifelineId}
    `)).rejects.toThrow(/incident scope invalid/i);
    const [forged] = await admin`
      select count(*)::integer as count from operational_assessments
      where legacy_record_id = ${legacyLifelineId} and incident_id = ${otherIncidentId}`;
    expect(forged!.count).toBe(0);

    const [beforeSpoof] = await admin`
      select count(*)::integer as count from operational_assessments
      where legacy_record_id = ${legacyLifelineId}`;
    await expect(withPerson(runtime, memberPersonId, (tx) => tx`
      update board_records
      set data = jsonb_set(data, '{note}', '"forged actor note"'::jsonb),
        updated_by = ${adminPersonId}, updated_at = now()
      where id = ${legacyLifelineId}
    `)).rejects.toThrow(/attribution mismatch/i);
    const [afterSpoof] = await admin`
      select count(*)::integer as count from operational_assessments
      where legacy_record_id = ${legacyLifelineId}`;
    expect(afterSpoof!.count).toBe(beforeSpoof!.count);

    const [oracle] = await withPerson(runtime, outsiderPersonId, (tx) => tx`
      select operational_supersedes_matches(
        ${partnerCapture!.id as string}, ${incidentId}, 'lifeline',
        'fema_community_lifelines', 'energy') as allowed`);
    expect(oracle!.allowed).toBe(false);

    const revoked = await app.inject({
      method: "POST",
      url: `/api/v1/incidents/${incidentId}/participants/${participantId}/revoke`,
      headers: auth(adminToken), payload: { reason: "Assessment role ended" },
    });
    expect(revoked.statusCode).toBe(200);
    expect((await app.inject({
      method: "POST", url: lifelineUrl(), headers: auth(partnerToken),
      payload: lifelinePayload("unstable"),
    })).statusCode).toBe(404);
  });

  it("keeps assessment and decision history immutable", async () => {
    const [assessment] = await admin`select id from operational_assessments limit 1`;
    await expect(admin`
      update operational_assessments set payload = '{}'::jsonb where id = ${assessment!.id as string}
    `).rejects.toThrow(/append-only|immutable/i);
    const [decision] = await admin`select id from operational_assessment_decisions limit 1`;
    await expect(admin`
      delete from operational_assessment_decisions where id = ${decision!.id as string}
    `).rejects.toThrow(/append-only|immutable/i);
  });
});
