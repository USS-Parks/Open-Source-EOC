import type { Sql } from "../db/client.js";
import {
  addMembership,
  assignPosition,
  createJurisdiction,
  createPerson,
  principalForPerson,
  type Principal,
} from "../auth/service.js";
import { createBoard, createRecord, ensureStandardTemplates } from "../boards/service.js";
import { loadDataset, registerDataPack } from "../data-packs/service.js";
import { putDashboardConfig } from "../dashboards/config.js";
import { createDashboard, ensureStandardDashboards } from "../dashboards/service.js";
import { withPerson } from "../db/context.js";
import { createEsfAssessment } from "../esf/service.js";
import { storeForm } from "../forms/service.js";
import { reviseIncidentArea } from "../incidents/area.js";
import { activateIncident, ensureStandardIncidentTemplates } from "../incidents/service.js";
import { updateIncidentTask } from "../incidents/tasks.js";
import { authorAlert } from "../cap/service.js";
import { createLifelineAssessment } from "../lifelines/service.js";
import { submitRequest, transition } from "../resource/service.js";
import { draftRelease } from "../jic/service.js";
import { recordObservation } from "../aar/service.js";

/**
 * The demo dataset. It stands up a believable activation a stranger
 * can explore and run the scripted exercise (docs/DEMO-SCENARIO.md) against:
 * a jurisdiction with an admin, an operator, and a viewer; an activated
 * synthetic wildfire exercise with its ICS org, boards, operational period,
 * area, an assigned task, an attached field-report form, mixed-freshness
 * lifeline/ESF assessments, a partial-coverage dataset, a local exercise CAP
 * record, a resource request, a JIC draft, and an AAR observation. It uses the
 * same services the app does while keeping every operational fact visibly
 * synthetic and making no outbound delivery claim.
 */

export interface DemoResult {
  readonly jurisdictionId: string;
  readonly incidentId: string;
  readonly adminId: string;
  readonly memberId: string;
  readonly viewerId: string;
  readonly capAlertId: string;
  readonly resourceRequestId: string;
  readonly releaseId: string;
}

const PW = "correct-horse-battery";

export async function ensureDemoData(sql: Sql): Promise<DemoResult> {
  const jurisdictionId = await createJurisdiction(sql, "demo", "Synthetic Demo County OES");
  const adminId = await createPerson(sql, {
    email: "demo-admin@example.org",
    displayName: "Dana Admin",
    password: PW,
  });
  const memberId = await createPerson(sql, {
    email: "demo-operator@example.org",
    displayName: "Omar Operator",
    password: PW,
  });
  const viewerId = await createPerson(sql, {
    email: "demo-viewer@example.org",
    displayName: "Val Viewer",
    password: PW,
  });
  await addMembership(sql, adminId, jurisdictionId, "admin");
  await addMembership(sql, memberId, jurisdictionId, "member");
  await addMembership(sql, viewerId, jurisdictionId, "viewer");

  await ensureStandardTemplates(sql);
  await ensureStandardIncidentTemplates(sql);
  await ensureStandardDashboards(sql);

  const actor: Principal = {
    sessionId: "demo",
    person: { id: adminId, email: "demo-admin@example.org", displayName: "Dana Admin" },
    position: null,
    memberships: [{ jurisdictionId, role: "admin" }],
    isInstanceAdmin: true,
    guests: [],
  };

  const seeded = await withPerson(sql, adminId, async (tx) => {
    const activation = await activateIncident(tx, actor, jurisdictionId, {
      templateKey: "wildfire",
      name: "SYNTHETIC Ridge Wildfire Exercise",
    });
    const incidentId = activation.incidentId;
    const now = Date.now();
    const operationalPeriod = "OP SYNTHETIC 1";
    const recent = new Date(now - 30 * 60 * 1_000).toISOString();
    const stale = new Date(now - 26 * 60 * 60 * 1_000).toISOString();

    const fieldReportBoardId = await createBoard(
      tx,
      actor,
      jurisdictionId,
      "field_reports",
      undefined,
      "SYNTHETIC Ridge Wildfire Exercise: Field Reports",
    );
    await tx`insert into incident_boards (incident_id, board_id)
      values (${incidentId}, ${fieldReportBoardId})`;
    const dashboardId = await createDashboard(
      tx,
      actor,
      jurisdictionId,
      "eoc_status",
      undefined,
      "SYNTHETIC Incident Overview",
    );

    await reviseIncidentArea(tx, actor, incidentId, {
      expectedRevision: 0,
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-124.2, 40.2], [-123.7, 40.2], [-123.7, 40.9],
          [-124.2, 40.9], [-124.2, 40.2],
        ]],
      },
      operationalPeriod: {
        label: operationalPeriod,
        startsAt: new Date(now - 60 * 60 * 1_000).toISOString(),
        endsAt: new Date(now + 11 * 60 * 60 * 1_000).toISOString(),
      },
      reason: "SYNTHETIC exercise area and first operational period",
    });

    const [logBoard] = await tx`
      select b.id from boards b join incident_boards ib on ib.board_id = b.id
      where ib.incident_id = ${incidentId} and b.template_key = 'activity_log' limit 1`;
    if (logBoard) {
      const boardId = logBoard.id as string;
      await createRecord(tx, actor, boardId,
        { entry: "SYNTHETIC: command established at the exercise EOC", notable: true }, incidentId);
      await createRecord(tx, actor, boardId,
        { entry: "SYNTHETIC: ridge evacuation decision logged for exercise play" }, incidentId);
    }
    const [roadBoard] = await tx`
      select b.id from boards b join incident_boards ib on ib.board_id = b.id
      where ib.incident_id = ${incidentId} and b.template_key = 'road_closures' limit 1`;
    if (!roadBoard) throw new Error("synthetic incident has no road-closures board");
    await createRecord(tx, actor, roadBoard.id as string, {
      road: "SYNTHETIC Route 12",
      reason: "Exercise closure for the seeded incident overview",
      status: "closed",
      location: { type: "Point", coordinates: [-124.05, 40.55] },
    }, incidentId);

    const [operatorPosition] = await tx`
      select p.id from incident_positions ip join positions p on p.id = ip.position_id
      where ip.incident_id = ${incidentId} and p.key = 'operations_section_chief'`;
    if (!operatorPosition) throw new Error("synthetic incident has no operations position");
    await assignPosition(tx, actor, operatorPosition.id as string, memberId);

    const [task] = await tx`
      select c.id, c.revision from checklist_items c join positions p on p.id = c.position_id
      where c.incident_id = ${incidentId} and c.status = 'open'
        and p.key = 'operations_section_chief'
      order by c.created_at, c.id limit 1`;
    if (task) {
      await updateIncidentTask(tx, actor, incidentId, task.id as string, {
        expectedRevision: Number(task.revision),
        status: "in_progress",
      });
    }

    await storeForm(tx, actor, jurisdictionId, {
      key: "synthetic_field_report",
      version: 1,
      title: "SYNTHETIC rapid field report",
      boardTemplate: "field_reports",
      nodes: [
        { kind: "field", name: "summary", type: "text", label: "Summary", required: true },
        { kind: "field", name: "category", type: "select_one", label: "Category", required: true,
          choices: [
            { name: "hazard", label: "Hazard" },
            { name: "damage", label: "Damage" },
            { name: "resource", label: "Resource" },
            { name: "other", label: "Other" },
          ] },
        { kind: "field", name: "location", type: "geopoint", label: "Location" },
      ],
    });

    const pack = await registerDataPack(tx, actor, incidentId, {
      name: "SYNTHETIC partial road-coverage exercise pack",
      organizationSlug: "demo",
      description: "Exercise-only simulated road data; not authoritative Caltrans information.",
      datasets: [{
        key: "caltrans_lcs_closures",
        name: "SYNTHETIC partial road coverage — not Caltrans data",
        kind: "geojson",
        fieldMapping: {
          title: "properties.title",
          category: "properties.category",
          status: "properties.status",
          sourceId: "properties.id",
          geometry: "geometry",
        },
        coverage: {
          type: "Polygon",
          coordinates: [[
            [-124.2, 40.2], [-123.95, 40.2], [-123.95, 40.9],
            [-124.2, 40.9], [-124.2, 40.2],
          ]],
        },
        staleAfterSeconds: 3600,
      }],
    });
    const [dataset] = await tx`
      select id from data_pack_datasets
      where pack_id = ${pack.id} and key = 'caltrans_lcs_closures'`;
    if (!dataset) throw new Error("synthetic partial-coverage dataset was not registered");
    await loadDataset(tx, actor, dataset.id as string, { records: [{
      properties: {
        id: "synthetic-closure-1",
        title: "SYNTHETIC Route 12 exercise closure",
        category: "exercise_closure",
        status: "closed",
      },
      geometry: { type: "Point", coordinates: [-124.05, 40.55] },
    }] });

    const rr = await submitRequest(tx, actor, jurisdictionId, {
      origin: "eoc",
      item: "SYNTHETIC portable generators",
      quantity: 3,
      priority: "immediate",
      notes: "Exercise request; no real resource order or delivery.",
      incidentId,
    });
    await transition(tx, actor, rr.id, "accepted");

    await createLifelineAssessment(tx, actor, incidentId, {
      lifeline: "energy",
      definitionVersion: 1,
      condition: "unstable",
      assessedAt: recent,
      confidence: "confirmed",
      impactStatement: "SYNTHETIC: ridge distribution is interrupted; generator support is pending.",
      operationalPeriod,
      stabilizationOutlook: "Estimated restoration is unavailable pending exercise damage assessment.",
      components: [{
        key: "electric_power",
        label: "Electric power",
        condition: "unstable",
        impactStatement: "SYNTHETIC outage affects the ridge shelter corridor.",
        affectedGeography: "Synthetic ridge exercise area",
        causes: ["Exercise wildfire damage"],
        dependencies: ["Transportation access"],
      }],
      evidence: [{
        kind: "reported",
        description: "SYNTHETIC utility liaison report",
        sourceOrganizationId: jurisdictionId,
        sourceReference: "DEMO-ENERGY-1",
        observedAt: recent,
      }],
      responsibleOrganizationIds: [jurisdictionId],
      actions: [{
        key: "stage_generators",
        title: "Stage synthetic generator request",
        status: "in_progress",
        responsibleOrganizationId: jurisdictionId,
        linkedResourceRequestId: rr.id,
      }],
    });
    await createLifelineAssessment(tx, actor, incidentId, {
      lifeline: "communications",
      definitionVersion: 1,
      condition: "unknown",
      assessedAt: recent,
      confidence: "unknown",
      impactStatement: "SYNTHETIC: field communications coverage has not yet been verified.",
      operationalPeriod,
      components: [],
      evidence: [],
      responsibleOrganizationIds: [],
      actions: [],
    });
    await createLifelineAssessment(tx, actor, incidentId, {
      lifeline: "transportation",
      definitionVersion: 1,
      condition: "stabilizing",
      assessedAt: stale,
      confidence: "estimated",
      impactStatement: "SYNTHETIC stale estimate: one access route was previously constrained.",
      operationalPeriod,
      components: [],
      evidence: [{
        kind: "reported",
        description: "SYNTHETIC exercise route report; intentionally stale",
        observedAt: stale,
      }],
      responsibleOrganizationIds: [],
      actions: [],
    });

    await createEsfAssessment(tx, actor, incidentId, {
      identity: { framework: "california", esf: "ca_esf_12", definitionVersion: 1 },
      activation: "activated",
      capacity: "constrained",
      assessedAt: recent,
      confidence: "confirmed",
      situation: "SYNTHETIC: energy coordination is active with generator support pending.",
      operationalPeriod,
      coordinatorOrganizationId: jurisdictionId,
      supportingOrganizationIds: [],
      missions: ["Coordinate synthetic generator staging"],
      priorities: ["Support the exercise shelter corridor"],
      evidence: [{ kind: "reported", description: "SYNTHETIC ESF-12 coordination update" }],
      relatedLifelines: ["energy"],
      actions: [],
    });
    await createEsfAssessment(tx, actor, incidentId, {
      identity: { framework: "california", esf: "ca_esf_1", definitionVersion: 1 },
      activation: "activated",
      capacity: "constrained",
      assessedAt: stale,
      confidence: "estimated",
      situation: "SYNTHETIC stale estimate: north-route access remained constrained.",
      operationalPeriod,
      supportingOrganizationIds: [],
      missions: [],
      priorities: [],
      evidence: [{ kind: "reported", description: "SYNTHETIC route status; intentionally stale" }],
      relatedLifelines: ["transportation"],
      actions: [],
    });
    await createEsfAssessment(tx, actor, incidentId, {
      identity: { framework: "california", esf: "ca_esf_2", definitionVersion: 1 },
      activation: "unknown",
      capacity: "unknown",
      assessedAt: recent,
      confidence: "unknown",
      situation: "SYNTHETIC: communications coordination status is not yet reported.",
      operationalPeriod,
      supportingOrganizationIds: [],
      missions: [],
      priorities: [],
      evidence: [],
      relatedLifelines: ["communications"],
      actions: [],
    });

    const cap = await authorAlert(tx, actor, jurisdictionId, {
      sender: "exercise@demo.example",
      status: "Exercise",
      msgType: "Alert",
      scope: "Public",
      info: [{
        language: "en-US",
        category: ["Fire"],
        event: "SYNTHETIC Wildfire Evacuation Exercise",
        urgency: "Immediate",
        severity: "Extreme",
        certainty: "Observed",
        headline: "EXERCISE: synthetic ridge evacuation message",
        description: "SYNTHETIC exercise content only. No public warning was transmitted.",
      }],
    }, incidentId);

    const release = await draftRelease(tx, actor, jurisdictionId, {
      title: "SYNTHETIC ridge exercise update",
      body: "Exercise-only draft: synthetic evacuation operations continue in the ridge area.",
      requiredAgencies: ["demo"],
      incidentId,
    });

    await recordObservation(tx, actor, incidentId, {
      capability: "Operational Coordination",
      kind: "strength",
      observation: "SYNTHETIC: exercise command was established within ten minutes of activation.",
    });

    return { incidentId, dashboardId, cap, rr, release };
  });

  const overview = {
    title: "SYNTHETIC Incident Overview",
    panels: [
      {
        key: "lifeline_status",
        title: "Lifeline board status",
        source: "dashboard" as const,
        dashboardId: seeded.dashboardId,
        widgetKey: "lifelines",
        presentation: "status" as const,
      },
      {
        key: "closure_map",
        title: "Synthetic road closures map",
        source: "dashboard" as const,
        dashboardId: seeded.dashboardId,
        widgetKey: "active_closures",
        presentation: "map" as const,
      },
      {
        key: "closure_list",
        title: "Synthetic active closures",
        source: "dashboard" as const,
        dashboardId: seeded.dashboardId,
        widgetKey: "active_closures",
        presentation: "list" as const,
      },
    ],
  };
  for (const personId of [adminId, memberId, viewerId]) {
    const principal = await principalForPerson(sql, personId);
    await withPerson(sql, personId, (tx) =>
      putDashboardConfig(tx, principal, seeded.incidentId, "incident-overview", 0, overview));
  }

  return {
    jurisdictionId,
    incidentId: seeded.incidentId,
    adminId,
    memberId,
    viewerId,
    capAlertId: seeded.cap.id,
    resourceRequestId: seeded.rr.id,
    releaseId: seeded.release.id,
  };
}
