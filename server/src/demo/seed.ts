import type { Sql } from "../db/client.js";
import { addMembership, createJurisdiction, createPerson, type Principal } from "../auth/service.js";
import { createRecord, ensureStandardTemplates } from "../boards/service.js";
import { activateIncident, ensureStandardIncidentTemplates } from "../incidents/service.js";
import { authorAlert } from "../cap/service.js";
import { submitRequest, transition } from "../resource/service.js";
import { draftRelease } from "../jic/service.js";
import { recordObservation } from "../aar/service.js";

/**
 * The demo dataset (VEOC-41). It stands up a believable activation a stranger
 * can explore and run the scripted exercise (docs/DEMO-SCENARIO.md) against:
 * a jurisdiction with an admin, an operator, and a viewer; an activated
 * wildfire incident with its ICS org, boards, and log; a public CAP evacuation
 * alert; a resource request in flight; a JIC press release; and an AAR
 * observation. It uses the same services the app does, so the demo is real
 * data, not fixtures.
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
  const jurisdictionId = await createJurisdiction(sql, "demo", "Demo County OES");
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

  const actor: Principal = {
    sessionId: "demo",
    person: { id: adminId, email: "demo-admin@example.org", displayName: "Dana Admin" },
    position: null,
    memberships: [{ jurisdictionId, role: "admin" }],
    isInstanceAdmin: true,
    guests: [],
  };

  const activation = await activateIncident(sql, actor, jurisdictionId, {
    templateKey: "wildfire",
    name: "Demo Wildfire",
  });
  const incidentId = activation.incidentId;

  const [logBoard] = await sql`
    select b.id from boards b join incident_boards ib on ib.board_id = b.id
    where ib.incident_id = ${incidentId} and b.template_key = 'activity_log' limit 1`;
  if (logBoard) {
    const boardId = logBoard.id as string;
    await createRecord(sql, actor, boardId, { entry: "Command established at the EOC", notable: true });
    await createRecord(sql, actor, boardId, { entry: "Evacuation of the ridge ordered" });
  }

  const cap = await authorAlert(sql, actor, jurisdictionId, {
    sender: "oes@demo.example",
    status: "Actual",
    msgType: "Alert",
    scope: "Public",
    info: [
      {
        category: ["Fire"],
        event: "Wildfire Evacuation",
        urgency: "Immediate",
        severity: "Extreme",
        certainty: "Observed",
        headline: "Evacuate the ridge now",
        description: "A fast-moving wildfire threatens the ridge; leave immediately.",
      },
    ],
  });

  const rr = await submitRequest(sql, actor, jurisdictionId, {
    origin: "eoc",
    item: "Type 1 Strike Team",
    quantity: 1,
    priority: "immediate",
  });
  await transition(sql, actor, rr.id, "triaged");

  const release = await draftRelease(sql, actor, jurisdictionId, {
    title: "Ridge evacuation order in effect",
    body: "Residents of the ridge must evacuate now via the north route.",
    requiredAgencies: ["demo"],
  });

  await recordObservation(sql, actor, incidentId, {
    capability: "Operational Coordination",
    kind: "strength",
    observation: "Command was established within ten minutes of activation.",
  });

  return {
    jurisdictionId,
    incidentId,
    adminId,
    memberId,
    viewerId,
    capAlertId: cap.id,
    resourceRequestId: rr.id,
    releaseId: release.id,
  };
}
