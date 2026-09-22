import type { Principal } from "../auth/service.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureDemoData, type DemoResult } from "../demo/seed.js";
import { composeAndStoreAar, exportAarPdf, recordObservation } from "../aar/service.js";
import { freshDb, type Sql } from "./helpers.js";

/**
 * The exercise dry-run. The functional exercise runs on the demo
 * activation, and the platform produces its own after-action report from the
 * exercise's observations and chronology (the AAR module eating its own cooking).
 * The real-user pilot on a selected jurisdiction is gated on Basho's
 * external-engagement authorization (contract item 12); this proves the
 * mechanism the pilot will use.
 */

let admin: Sql;
let demo: DemoResult;
let actor: Principal;

beforeAll(async () => {
  const db = await freshDb();
  admin = db.admin;
  demo = await ensureDemoData(admin);
  actor = {
    sessionId: "exercise",
    person: { id: demo.adminId, email: "demo-admin@example.org", displayName: "Dana Admin" },
    position: null,
    memberships: [{ jurisdictionId: demo.jurisdictionId, role: "admin" }],
    isInstanceAdmin: true,
    guests: [],
  };
}, 60000);

afterAll(async () => {
  if (admin) await admin.end();
});

describe("the platform produces its own exercise AAR", () => {
  it("composes an AAR from the exercise observations and chronology and exports it", async () => {
    // Evaluators capture observations during the exercise, not after.
    await recordObservation(admin, actor, demo.incidentId, {
      capability: "operational_coordination",
      kind: "strength",
      observation: "Command was established and the evacuation ordered within the first period.",
    });
    await recordObservation(admin, actor, demo.incidentId, {
      capability: "public_information_and_warning",
      capabilityElement: "planning",
      kind: "improvement",
      observation: "The press release drafted but was not yet approved when the alert went out.",
      recommendation: "Pre-stage an approval chain for evacuation messaging.",
    });

    const aar = await composeAndStoreAar(admin, actor, demo.incidentId, {
      overview: "Functional exercise on the demo wildfire activation.",
      objectives: ["Exercise operational coordination", "Exercise public information and warning"],
      period: "Exercise, 2026-09-18",
    });

    // The platform's own AAR, from the exercise's own evidence.
    expect(aar.content.strengths.length).toBeGreaterThanOrEqual(1);
    expect(aar.content.improvements.length).toBeGreaterThanOrEqual(1);
    expect(aar.content.chronologyCount).toBeGreaterThan(0);

    const pdf = await exportAarPdf(admin, actor, aar.id);
    expect(Buffer.from(pdf.bytes).subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
  });
});
