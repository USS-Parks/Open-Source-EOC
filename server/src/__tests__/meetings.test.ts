import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createPerson, principalForPerson, type Principal } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import {
  configureMeetingBridge,
  getMeetingConfig,
  listBriefings,
  openBridge,
  runDueBriefings,
  scheduleBriefing,
} from "../meetings/service.js";
import { verifyJitsiJwt } from "../meetings/jitsi.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Meeting bridges and briefings (F15/R4). One action yields a
 * joinable Jitsi bridge scoped to the incident audience; scheduled briefings
 * notify the holders through the notifications substrate; and neither depends on
 * any Jitsi code being vendored.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let adminId: string;
let memberId: string;
let adminToken: string;
let adminPrincipal: Principal;
let memberPrincipal: Principal;
let incidentId: string;
let priorKey: string | undefined;

const JITSI_SECRET = "jitsi-shared-secret";

beforeAll(async () => {
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-meetings-key";
  const db = await freshDb();
  admin = db.admin;
  runtime = db.runtime;
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  adminId = seed.adminId;
  memberId = seed.memberId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  adminToken = (
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@example.org", password: "correct-horse-battery" },
    })
  ).json().accessToken as string;
  adminPrincipal = await principalForPerson(runtime, adminId);
  memberPrincipal = await principalForPerson(runtime, memberId);

  const act = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { templateKey: "wildfire", name: "Bald Hills Fire" },
  });
  incidentId = act.json().incidentId as string;
  const detail = (
    await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
  ).json();
  const posId = (key: string): string =>
    detail.positions.find((p: { key: string; id: string }) => p.key === key).id;
  for (const [key, personId] of [
    ["incident_commander", adminId],
    ["operations_section_chief", memberId],
  ] as const) {
    await app.inject({
      method: "POST",
      url: `/api/v1/positions/${posId(key)}/assignments`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { personId },
    });
  }
}, 60000);

afterAll(async () => {
  if (app) await app.close();
  if (runtime) await runtime.end();
  if (admin) await admin.end();
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
});

describe("meeting bridge", () => {
  it("refuses to open a bridge before the deployment is configured", async () => {
    await expect(
      withPerson(runtime, adminId, (tx) => openBridge(tx, adminPrincipal, incidentId, null)),
    ).rejects.toThrow(/not configured/);
  });

  it("opens a stable, joinable bridge once configured (no auth)", async () => {
    await withPerson(runtime, adminId, (tx) =>
      configureMeetingBridge(tx, adminPrincipal, jurisdictionId, {
        baseUrl: "https://meet.example.org",
        enabled: true,
      }),
    );
    const status = await withPerson(runtime, adminId, (tx) =>
      getMeetingConfig(tx, adminPrincipal, jurisdictionId),
    );
    expect(status.enabled).toBe(true);
    expect(status.authenticated).toBe(false);

    const first = await withPerson(runtime, adminId, (tx) =>
      openBridge(tx, adminPrincipal, incidentId, null),
    );
    expect(first.url).toBe(`https://meet.example.org/${first.room}`);
    const second = await withPerson(runtime, adminId, (tx) =>
      openBridge(tx, adminPrincipal, incidentId, null),
    );
    // The link is stable: the same room comes back on the next click.
    expect(second.room).toBe(first.room);
  });

  it("mints a per-caller JWT that scopes the room to the audience", async () => {
    await withPerson(runtime, adminId, (tx) =>
      configureMeetingBridge(tx, adminPrincipal, jurisdictionId, {
        baseUrl: "https://meet.example.org",
        appId: "eoc",
        secret: JITSI_SECRET,
        enabled: true,
      }),
    );
    const bridge = await withPerson(runtime, adminId, (tx) =>
      openBridge(tx, adminPrincipal, incidentId, "operations"),
    );
    expect(bridge.url).toContain("?jwt=");
    const token = bridge.url.split("?jwt=")[1]!;
    const payload = verifyJitsiJwt(JITSI_SECRET, token);
    expect(payload.room).toBe(bridge.room);
    expect(payload.aud).toBe("jitsi");
    const ctx = payload.context as { user: { email: string; moderator: boolean } };
    expect(ctx.user.email).toBe("admin@example.org");
    expect(ctx.user.moderator).toBe(true);

    // A plain member joins the same room but is not a moderator.
    const memberBridge = await withPerson(runtime, memberId, (tx) =>
      openBridge(tx, memberPrincipal, incidentId, "operations"),
    );
    const memberPayload = verifyJitsiJwt(JITSI_SECRET, memberBridge.url.split("?jwt=")[1]!);
    expect(memberBridge.room).toBe(bridge.room);
    expect((memberPayload.context as { user: { moderator: boolean } }).user.moderator).toBe(false);

    // A forged token (wrong secret) does not verify.
    expect(() => verifyJitsiJwt("wrong-secret", token)).toThrow();
  });

  it("denies a non-member (outside the incident audience)", async () => {
    const outsiderId = await createPerson(admin, {
      email: "outsider@example.org",
      displayName: "Outsider",
      password: "correct-horse-battery",
    });
    const outsider = await principalForPerson(runtime, outsiderId);
    await expect(
      withPerson(runtime, outsiderId, (tx) => openBridge(tx, outsider, incidentId, null)),
    ).rejects.toThrow();
  });
});

describe("briefings", () => {
  it("fires due briefings once, notifying the incident holders via the notifications substrate", async () => {
    await withPerson(runtime, adminId, (tx) =>
      scheduleBriefing(tx, adminPrincipal, incidentId, {
        title: "Operational period 1 briefing",
        scheduledAt: new Date(Date.now() - 60_000),
      }),
    );
    await withPerson(runtime, adminId, (tx) =>
      scheduleBriefing(tx, adminPrincipal, incidentId, {
        title: "Future briefing",
        scheduledAt: new Date(Date.now() + 3_600_000),
      }),
    );

    const run = await withPerson(runtime, adminId, (tx) =>
      runDueBriefings(tx, adminPrincipal, jurisdictionId),
    );
    // One due briefing; two holders notified (IC and operations chief).
    expect(run.fired).toBe(1);
    expect(run.notified).toBe(2);

    const notes = await admin`
      select count(*)::int as n from notifications
      where channel = 'briefing' and jurisdiction_id = ${jurisdictionId}`;
    expect(notes[0]!.n).toBe(2);

    // Running again fires nothing: the due briefing is already stamped.
    const again = await withPerson(runtime, adminId, (tx) =>
      runDueBriefings(tx, adminPrincipal, jurisdictionId),
    );
    expect(again.fired).toBe(0);

    // The future briefing is still pending on the calendar.
    const list = await withPerson(runtime, adminId, (tx) =>
      listBriefings(tx, adminPrincipal, incidentId),
    );
    const future = list.find((b) => b.title === "Future briefing")!;
    expect(future.notifiedAt).toBeNull();
  });
});
