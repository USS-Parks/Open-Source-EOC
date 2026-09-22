import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor("admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor("member@example.org", "another-good-password");
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

async function tokenFor(email: string, password: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(response.statusCode).toBe(200);
  return response.json().accessToken as string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe("notification read and acknowledgement", () => {
  it("keeps opening, reading, and acknowledgement as separately attributed state", async () => {
    const [inserted] = await admin`
      insert into notifications (jurisdiction_id, person_id, channel, title, body, status, detail)
      values (${seed.jurisdictionId}, ${seed.memberId}, 'workflow', 'Review assignment',
        'A shelter request needs review.', 'delivered', ${admin.json({ incidentId: null } as never)})
      returning id`;
    const id = inserted!.id as string;

    const listed = await app.inject({ method: "GET", url: "/api/v1/notifications", headers: auth(adminToken) });
    expect(listed.statusCode).toBe(200);
    const initial = (listed.json().notifications as Array<Record<string, unknown>>).find((item) => item.id === id)!;
    expect(initial.assigned_to_current_actor).toBe(false);
    expect(initial.read_at).toBeNull();
    expect(initial.acknowledged_at).toBeNull();
    expect(initial.destination).toContain("Person");

    const deniedRead = await app.inject({ method: "POST", url: `/api/v1/notifications/${id}/read`, headers: auth(adminToken) });
    expect(deniedRead.statusCode).toBe(404);
    const deniedAck = await app.inject({ method: "POST", url: `/api/v1/notifications/${id}/acknowledge`, headers: auth(adminToken) });
    expect(deniedAck.statusCode).toBe(404);

    const memberList = await app.inject({ method: "GET", url: "/api/v1/notifications", headers: auth(memberToken) });
    const assigned = (memberList.json().notifications as Array<Record<string, unknown>>).find((item) => item.id === id)!;
    expect(assigned.assigned_to_current_actor).toBe(true);
    const read = await app.inject({ method: "POST", url: `/api/v1/notifications/${id}/read`, headers: auth(memberToken) });
    expect(read.statusCode).toBe(200);
    const [afterRead] = await admin`select read_at, acknowledged_at from notifications where id = ${id}`;
    expect(afterRead!.read_at).not.toBeNull();
    expect(afterRead!.acknowledged_at).toBeNull();

    const acknowledged = await app.inject({ method: "POST", url: `/api/v1/notifications/${id}/acknowledge`, headers: auth(memberToken) });
    expect(acknowledged.statusCode).toBe(200);
    expect(acknowledged.json().acknowledged_by).toBe(seed.memberId);
    const repeated = await app.inject({ method: "POST", url: `/api/v1/notifications/${id}/acknowledge`, headers: auth(memberToken) });
    expect(repeated.statusCode).toBe(200);
    const [stored] = await admin`select acknowledged_at, acknowledged_by from notifications where id = ${id}`;
    expect(stored!.acknowledged_at).not.toBeNull();
    expect(stored!.acknowledged_by).toBe(seed.memberId);
    const [auditCount] = await admin`
      select count(*)::int as count from audit_events
      where category = 'notification.acknowledged' and subject_id = ${id}`;
    expect(auditCount!.count).toBe(1);
  });
});

describe("local CAP draft review", () => {
  it("stores an unsent local draft and appends attributed review transitions", async () => {
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/cap/drafts`,
      headers: auth(memberToken),
      payload: {
        alert: {
          sender: "duty@example.org",
          status: "Draft",
          msgType: "Alert",
          scope: "Public",
          info: [{
            language: "en-US", category: ["Safety"], event: "Shelter opening",
            urgency: "Expected", severity: "Moderate", certainty: "Likely",
            headline: "High school shelter open", description: "Shelter opens at 19:00.",
          }],
        },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    expect(created.json().reviewState).toBe("draft");
    const [stored] = await admin`select status, origin from cap_alerts where id = ${id}`;
    expect(stored).toMatchObject({ status: "Draft", origin: "authored" });
    const [notSent] = await admin`select count(*)::int as count from ipaws_submissions where cap_alert_id = ${id}`;
    expect(notSent!.count).toBe(0);
    const initialDetail = await app.inject({ method: "GET", url: `/api/v1/cap/alerts/${id}`, headers: auth(memberToken) });
    expect(initialDetail.json().transmission).toEqual({
      state: "not_attempted", environment: null, submittedAt: null, submittedByName: null,
    });

    await admin`
      insert into ipaws_submissions
        (jurisdiction_id, cap_alert_id, environment, accepted, detail, submitted_by, submitted_at)
      values
        (${seed.jurisdictionId}, ${id}, 'test', true, 'accepted', ${seed.adminId}, now() - interval '1 minute'),
        (${seed.jurisdictionId}, ${id}, 'production', false, 'rejected', ${seed.adminId}, now())`;

    const skip = await app.inject({ method: "POST", url: `/api/v1/cap/alerts/${id}/review`, headers: auth(memberToken), payload: { state: "approved" } });
    expect(skip.statusCode).toBe(409);
    const review = await app.inject({ method: "POST", url: `/api/v1/cap/alerts/${id}/review`, headers: auth(memberToken), payload: { state: "in_review" } });
    expect(review.statusCode, review.body).toBe(200);
    expect(review.json().actorName).toBe("Member");
    expect(review.json().revision).toBe(2);
    const approve = await app.inject({ method: "POST", url: `/api/v1/cap/alerts/${id}/review`, headers: auth(adminToken), payload: { state: "approved" } });
    expect(approve.statusCode, approve.body).toBe(200);
    expect(approve.json().revision).toBe(3);

    const detail = await app.inject({ method: "GET", url: `/api/v1/cap/alerts/${id}`, headers: auth(memberToken) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().review).toMatchObject({ state: "approved", actorName: "Admin" });
    expect(detail.json().transmission).toMatchObject({
      state: "rejected", environment: "production", submittedByName: "Admin",
    });
    expect(detail.json().transmission.submittedAt).toEqual(expect.any(String));
    const listed = await app.inject({ method: "GET", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/cap/alerts`, headers: auth(memberToken) });
    const listedAlert = (listed.json().alerts as Array<{ id: string; transmission: Record<string, unknown> }>)
      .find((alert) => alert.id === id)!;
    expect(listedAlert.transmission).toMatchObject({
      state: "rejected", environment: "production",
    });
    const events = await admin`select revision, state, actor_person_id from cap_alert_reviews where alert_id = ${id} order by revision`;
    expect(events.map((event) => event.state)).toEqual(["draft", "in_review", "approved"]);
    expect(events.map((event) => event.revision)).toEqual([1, 2, 3]);
    expect(events[2]!.actor_person_id).toBe(seed.adminId);
  });

  it("rejects actual-status content on the local-only draft route", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/cap/drafts`,
      headers: auth(memberToken),
      payload: { alert: { sender: "duty@example.org", status: "Actual", msgType: "Alert", scope: "Public", info: [] } },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().issues[0].path).toBe("status");
  });

  it("serializes concurrent non-incident review transitions into one deterministic revision", async () => {
    const created = await app.inject({
      method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/cap/drafts`,
      headers: auth(memberToken), payload: { alert: {
        sender: "duty@example.org", status: "Draft", msgType: "Alert", scope: "Public",
        info: [{ language: "en-US", category: ["Safety"], event: "Concurrent review", urgency: "Unknown", severity: "Unknown", certainty: "Unknown" }],
      } },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const attempts = await Promise.all([1, 2].map(() => app.inject({
      method: "POST", url: `/api/v1/cap/alerts/${id}/review`, headers: auth(memberToken), payload: { state: "in_review" },
    })));
    expect(attempts.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const revisions = await admin`select revision, state from cap_alert_reviews where alert_id = ${id} order by revision`;
    expect(revisions).toMatchObject([{ revision: 1, state: "draft" }, { revision: 2, state: "in_review" }]);
  });

  it("rejects authoring and review changes after incident closeout", async () => {
    const incident = await app.inject({
      method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
      headers: auth(adminToken), payload: { templateKey: "wildfire", name: "Closed alert incident" },
    });
    expect(incident.statusCode, incident.body).toBe(201);
    const incidentId = incident.json().incidentId as string;
    const payload = { alert: {
      sender: "duty@example.org", status: "Draft", msgType: "Alert", scope: "Public",
      info: [{ language: "en-US", category: ["Safety"], event: "Closeout check", urgency: "Unknown", severity: "Unknown", certainty: "Unknown" }],
    }, incidentId };
    const created = await app.inject({
      method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/cap/drafts`, headers: auth(memberToken), payload,
    });
    expect(created.statusCode, created.body).toBe(201);
    await admin`update incidents set closed_at = now(), closed_by = ${seed.adminId} where id = ${incidentId}`;
    const review = await app.inject({
      method: "POST", url: `/api/v1/cap/alerts/${created.json().id as string}/review`, headers: auth(memberToken), payload: { state: "in_review" },
    });
    expect(review.statusCode).toBe(409);
    const author = await app.inject({
      method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/cap/drafts`, headers: auth(memberToken), payload,
    });
    expect(author.statusCode).toBe(409);
    const [stored] = await admin`
      select count(*)::int as alert_count,
        (select count(*)::int from cap_alert_reviews r
          join cap_alerts a on a.id = r.alert_id where a.incident_id = ${incidentId}) as review_count
      from cap_alerts where incident_id = ${incidentId}`;
    expect(stored).toMatchObject({ alert_count: 1, review_count: 1 });
  });
});
