import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STANDARD_TEMPLATES } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { exportPackage, generateSigningKeyPair } from "../boards/package.js";
import { createPerson, addMembership, createJurisdiction } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { withPerson } from "../db/context.js";
import { onBoardEvent } from "../events/bus.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

const signer = generateSigningKeyPair();

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let viewerId: string;
let guestId: string;
let outsiderId: string;
let boardId: string;
let keyDir: string;
let priorKeys: string | undefined;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  viewerId = await createPerson(admin, {
    email: "viewer@example.org",
    displayName: "Viewer",
    password: "viewer-password-long",
  });
  await addMembership(admin, viewerId, seed.jurisdictionId, "viewer");
  guestId = await createPerson(admin, {
    email: "guest@example.org",
    displayName: "Guest",
    password: "guest-password-long",
  });
  outsiderId = await createPerson(admin, {
    email: "outsider@example.org",
    displayName: "Outsider",
    password: "outsider-password-1",
  });
  await admin`update persons set is_instance_admin = true
    where id = ${seed.adminId}`;
  // The publisher key reaches the app the way a deployment supplies it: a
  // PEM bundle file named by OPENEOC_TRUSTED_TEMPLATE_KEYS.
  keyDir = mkdtempSync(join(tmpdir(), "openeoc-keys-"));
  writeFileSync(join(keyDir, "publishers.pem"), `${signer.publicKeyPem}
`);
  priorKeys = process.env.OPENEOC_TRUSTED_TEMPLATE_KEYS;
  process.env.OPENEOC_TRUSTED_TEMPLATE_KEYS = join(keyDir, "publishers.pem");
  app = buildApp(runtime, { oidc: null });
});

afterAll(async () => {
  if (priorKeys === undefined) delete process.env.OPENEOC_TRUSTED_TEMPLATE_KEYS;
  else process.env.OPENEOC_TRUSTED_TEMPLATE_KEYS = priorKeys;
  rmSync(keyDir, { recursive: true, force: true });
  await app.close();
  await runtime.end();
  await admin.end();
});



describe("board lifecycle", () => {
  it("projects incident board shape and preserves cross-organization record history", async () => {
    await ensureStandardIncidentTemplates(admin);
    const ownerToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
    const template = {
      key: "participant_operations",
      version: 1,
      title: "Participant operations",
      fields: [
        { key: "public_note", label: "Public note", type: "text", required: true },
        { key: "owner_note", label: "Owner note", type: "text", read: "admin", write: "admin" },
        { key: "verified", label: "Verified", type: "boolean", read: "admin", write: "admin" },
      ],
      views: [
        { key: "all", title: "All", columns: ["public_note", "owner_note"],
          sort: { field: "owner_note", dir: "asc" } },
        { key: "owner_filter", title: "Owner filter", columns: ["public_note"],
          filter: [{ field: "owner_note", op: "eq", value: "owner" }] },
      ],
      inputLayout: { sections: [{ key: "input", title: "Input", fields: ["public_note", "owner_note", "verified"] }] },
      detailLayout: { sections: [{ key: "detail", title: "Detail", fields: ["public_note", "owner_note", "verified"] }] },
    };
    const published = await app.inject({ method: "POST", url: "/api/v1/templates",
      headers: auth(ownerToken), payload: template });
    expect(published.statusCode, published.body).toBe(201);
    const createdBoard = await app.inject({ method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, headers: auth(ownerToken),
      payload: { templateKey: template.key } });
    expect(createdBoard.statusCode, createdBoard.body).toBe(201);
    const incidentBoard = createdBoard.json().id as string;
    const activation = await app.inject({ method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, headers: auth(ownerToken),
      payload: { templateKey: "daily_ops", name: "Participant board history" } });
    expect(activation.statusCode, activation.body).toBe(201);
    const incidentId = activation.json().incidentId as string;
    await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${incidentBoard})`;

    const partnerJurisdiction = await createJurisdiction(admin, "board-partner", "Board Partner");
    const contributorId = await createPerson(admin, { email: "board-contributor@example.org",
      displayName: "Board Contributor", password: "board-contributor-password" });
    const participantViewerId = await createPerson(admin, { email: "board-viewer@example.org",
      displayName: "Board Viewer", password: "board-viewer-password" });
    const legacyContributorId = await createPerson(admin, { email: "legacy-board-contributor@example.org",
      displayName: "Legacy Board Contributor", password: "legacy-board-contributor-password" });
    await addMembership(admin, contributorId, partnerJurisdiction, "member");
    await addMembership(admin, participantViewerId, partnerJurisdiction, "member");
    await addMembership(admin, legacyContributorId, partnerJurisdiction, "member");
    const grant = async (email: string, role: "viewer" | "coordinator") => app.inject({ method: "POST",
      url: `/api/v1/incidents/${incidentId}/participants`, headers: auth(ownerToken), payload: {
        organizationSlug: "board-partner", personEmail: email,
        incidentPositionTitle: role === "coordinator" ? "Mutual Aid Coordinator" : "Mutual Aid Viewer",
        role, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), reason: "Board workspace proof",
      } });
    expect((await grant("board-contributor@example.org", "coordinator")).statusCode).toBe(201);
    expect((await grant("board-viewer@example.org", "viewer")).statusCode).toBe(201);
    const legacyGrant = await grant("legacy-board-contributor@example.org", "coordinator");
    expect(legacyGrant.statusCode, legacyGrant.body).toBe(201);
    const contributorToken = await tokenFor(app, "board-contributor@example.org", "board-contributor-password");
    const participantViewerToken = await tokenFor(app, "board-viewer@example.org", "board-viewer-password");
    const shapePath = `/api/v1/boards/${incidentBoard}?incidentId=${incidentId}`;
    const viewerShape = await app.inject({ method: "GET", url: shapePath, headers: auth(participantViewerToken) });
    expect(viewerShape.statusCode, viewerShape.body).toBe(200);
    expect(viewerShape.json()).toMatchObject({ canContribute: false,
      fields: [{ key: "public_note" }],
      views: [
        { key: "all", columns: ["public_note"], filter: [] },
        { key: "owner_filter", columns: ["public_note"], filter: [] },
      ],
      inputLayout: { sections: [{ fields: ["public_note"] }] },
      detailLayout: { sections: [{ fields: ["public_note"] }] },
    });
    expect(viewerShape.body).not.toContain("owner_note");
    expect(viewerShape.body).not.toContain("verified");
    expect(viewerShape.json().views[0]).not.toHaveProperty("sort");
    const contributorShape = await app.inject({ method: "GET", url: shapePath, headers: auth(contributorToken) });
    expect(contributorShape.statusCode, contributorShape.body).toBe(200);
    expect(contributorShape.json().canContribute).toBe(true);

    const recordPath = `/api/v1/boards/${incidentBoard}/records?incidentId=${incidentId}`;
    const ownerAdminCreate = await app.inject({ method: "POST", url: recordPath, headers: auth(ownerToken),
      payload: { public_note: "Owner verified", owner_note: "owner", verified: true } });
    expect(ownerAdminCreate.statusCode, ownerAdminCreate.body).toBe(201);
    const ownerAdminUpdate = await app.inject({ method: "PATCH",
      url: `/api/v1/boards/${incidentBoard}/records/${ownerAdminCreate.json().id as string}?incidentId=${incidentId}`,
      headers: auth(ownerToken), payload: { verified: false } });
    expect(ownerAdminUpdate.statusCode, ownerAdminUpdate.body).toBe(200);
    const contributorAdminField = await app.inject({ method: "POST", url: recordPath,
      headers: auth(contributorToken), payload: { public_note: "Partner denied", verified: true } });
    expect(contributorAdminField.statusCode, contributorAdminField.body).toBe(403);
    expect((await app.inject({ method: "POST", url: recordPath, headers: auth(participantViewerToken),
      payload: { public_note: "Viewer denied" } })).statusCode).toBe(403);
    const created = await app.inject({ method: "POST", url: recordPath, headers: auth(contributorToken),
      payload: { public_note: "Partner created" } });
    expect(created.statusCode, created.body).toBe(201);
    const recordId = created.json().id as string;
    const updatePath = `/api/v1/boards/${incidentBoard}/records/${recordId}`;
    const participantUpdate = await app.inject({ method: "PATCH",
      url: `${updatePath}?incidentId=${incidentId}`, headers: auth(contributorToken),
      payload: { public_note: "Partner revised" } });
    expect(participantUpdate.statusCode, participantUpdate.body).toBe(200);
    expect((await app.inject({ method: "PATCH", url: updatePath, headers: auth(ownerToken),
      payload: { public_note: "Owner revised", owner_note: "owner" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PATCH", url: updatePath, headers: auth(ownerToken),
      payload: { public_note: "Owner final", owner_note: "owner" } })).statusCode).toBe(200);

    const notificationRule = await app.inject({ method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/notification-rules`, headers: auth(ownerToken),
      payload: { boardId: incidentBoard, event: "record.updated", condition: { op: "any" },
        channels: [{ kind: "inapp", target: "requesting_position" }] } });
    expect(notificationRule.statusCode, notificationRule.body).toBe(201);
    const [notificationCountBefore] = await admin`
      select count(*)::int as count from notifications where rule_id = ${notificationRule.json().id as string}`;
    const publishedRecordIds: string[] = [];
    const unsubscribe = onBoardEvent((event) => publishedRecordIds.push(event.recordId));
    const noOpUpdate = await app.inject({ method: "PATCH", url: updatePath, headers: auth(ownerToken),
      payload: { public_note: "Owner final", owner_note: "owner" } });
    unsubscribe();
    expect(noOpUpdate.statusCode, noOpUpdate.body).toBe(200);
    expect(publishedRecordIds).toEqual([]);
    const [notificationCountAfter] = await admin`
      select count(*)::int as count from notifications where rule_id = ${notificationRule.json().id as string}`;
    expect(notificationCountAfter!.count).toBe(notificationCountBefore!.count);

    const detailPath = `${updatePath}/detail?incidentId=${incidentId}`;
    const viewerDetail = await app.inject({ method: "GET", url: detailPath, headers: auth(participantViewerToken) });
    expect(viewerDetail.statusCode, viewerDetail.body).toBe(200);
    expect(viewerDetail.json()).toMatchObject({ data: { public_note: "Owner final" }, canEdit: false });
    expect(viewerDetail.body).not.toContain("owner_note");
    expect(viewerDetail.json().history).toHaveLength(4);
    expect(viewerDetail.json().history.map((entry: { payload: { fields: string[] } }) => entry.payload.fields))
      .toEqual([["public_note"], ["public_note"], ["public_note"], ["public_note"]]);
    const participantView = await app.inject({ method: "GET",
      url: `/api/v1/boards/${incidentBoard}/views/all?incidentId=${incidentId}`,
      headers: auth(participantViewerToken) });
    expect(participantView.statusCode, participantView.body).toBe(200);
    expect(participantView.json()).toMatchObject({ columns: ["public_note"],
      records: expect.arrayContaining([expect.objectContaining({ public_note: "Owner final" })]) });
    expect(participantView.body).not.toContain("owner_note");
    const ownerDetail = await app.inject({ method: "GET", url: detailPath, headers: auth(ownerToken) });
    expect(ownerDetail.statusCode, ownerDetail.body).toBe(200);
    expect(ownerDetail.json().history.at(-2).payload.fields).toEqual(["owner_note", "public_note"]);
    expect(ownerDetail.json().history.at(-1).payload.fields).toEqual(["public_note"]);

    const [legacyRecord] = await admin`
      insert into board_records (board_id, data, created_by, incident_id)
      values (${incidentBoard}, ${admin.json({ public_note: "Legacy partner record" })},
        ${legacyContributorId}, ${incidentId})
      returning id`;
    const legacyRecordId = legacyRecord!.id as string;
    await admin`
      insert into audit_events
        (jurisdiction_id, incident_id, person_id, category, subject_table, subject_id, payload)
      values
        (${partnerJurisdiction}, ${incidentId}, ${legacyContributorId}, 'board.record.created',
          'board_records', ${legacyRecordId},
          ${admin.json({ board: template.key, data: { public_note: "Legacy partner record" } })}),
        (${partnerJurisdiction}, ${incidentId}, ${legacyContributorId}, 'board.record.created',
          'board_records', ${legacyRecordId},
          ${admin.json({ board: "unrelated_template", data: { public_note: "Unrelated audit" } })})`;
    const revokeLegacy = await app.inject({ method: "POST",
      url: `/api/v1/incidents/${incidentId}/participants/${legacyGrant.json().participant.id as string}/revoke`,
      headers: auth(ownerToken), payload: { reason: "Legacy history retention proof" } });
    expect(revokeLegacy.statusCode, revokeLegacy.body).toBe(200);
    const legacyDetailPath = `/api/v1/boards/${incidentBoard}/records/${legacyRecordId}/detail?incidentId=${incidentId}`;
    const legacyDetail = await app.inject({ method: "GET", url: legacyDetailPath, headers: auth(ownerToken) });
    expect(legacyDetail.statusCode, legacyDetail.body).toBe(200);
    expect(legacyDetail.json().history).toEqual([
      expect.objectContaining({ category: "board.record.created",
        actor: expect.objectContaining({ personId: legacyContributorId }),
        payload: { fields: ["public_note"] } }),
    ]);
    const outsiderToken = await tokenFor(app, "outsider@example.org", "outsider-password-1");
    expect((await app.inject({ method: "GET", url: legacyDetailPath,
      headers: auth(outsiderToken) })).statusCode).toBe(404);

    const closed = await app.inject({ method: "POST", url: `/api/v1/incidents/${incidentId}/close`,
      headers: auth(ownerToken) });
    expect(closed.statusCode, closed.body).toBe(200);
    const historicalDetail = await app.inject({ method: "GET", url: detailPath,
      headers: auth(participantViewerToken) });
    expect(historicalDetail.statusCode, historicalDetail.body).toBe(200);
    expect(historicalDetail.json().data.public_note).toBe("Owner final");
    const closedWriteAttempts = [
      { token: ownerToken, suffix: "owner", updateUrl: updatePath },
      { token: contributorToken, suffix: "contributor", updateUrl: `${updatePath}?incidentId=${incidentId}` },
    ];
    for (const attempt of closedWriteAttempts) {
      const deniedCreate = await app.inject({ method: "POST", url: recordPath, headers: auth(attempt.token),
        payload: { public_note: `Closed ${attempt.suffix} create` } });
      expect(deniedCreate.statusCode, deniedCreate.body).toBe(409);
      const deniedUpdate = await app.inject({ method: "PATCH",
        url: attempt.updateUrl, headers: auth(attempt.token),
        payload: { public_note: `Closed ${attempt.suffix} update` } });
      expect(deniedUpdate.statusCode, deniedUpdate.body).toBe(409);
    }
  });

  it("returns attributed record history without unreadable values or foreign incident rows", async () => {
    await ensureStandardIncidentTemplates(admin);
    const token = await tokenFor(app, "admin@example.org", "correct-horse-battery");
    const viewer = await tokenFor(app, "viewer@example.org", "viewer-password-long");
    const outside = await tokenFor(app, "outsider@example.org", "outsider-password-1");
    const board = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
      headers: auth(token), payload: { templateKey: "significant_events" } });
    const id = board.json().id as string;
    await admin`update boards set local_fields = ${admin.json([
      { key: "x_private", label: "Private", type: "text", read: "admin", write: "admin" },
    ])} where id = ${id}`;
    const record = await app.inject({ method: "POST", url: `/api/v1/boards/${id}/records`, headers: auth(token),
      payload: { summary: "Visible summary", occurred_at: "2026-09-21T10:00:00Z", severity: "warning", x_private: "Restricted value" } });
    expect(record.statusCode, record.body).toBe(201);
    const recordId = record.json().id as string;
    const patch = await app.inject({ method: "PATCH", url: `/api/v1/boards/${id}/records/${recordId}`, headers: auth(token),
      payload: { summary: "Updated summary", x_private: "Restricted update" } });
    expect(patch.statusCode, patch.body).toBe(200);
    const path = `/api/v1/boards/${id}/records/${recordId}/detail`;
    const detail = await app.inject({ method: "GET", url: path, headers: auth(viewer) });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json()).toMatchObject({ data: { summary: "Updated summary" }, canEdit: false,
      createdBy: { personId: seed.adminId }, updatedBy: { personId: seed.adminId } });
    expect(detail.json().history).toHaveLength(2);
    expect(detail.body).not.toContain("Restricted");
    expect(detail.body).not.toContain("x_private");
    expect((await app.inject({ method: "GET", url: path, headers: auth(outside) })).statusCode).toBe(404);
    const incident = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`,
      headers: auth(token), payload: { templateKey: "daily_ops", name: "Detail scope" } });
    expect(incident.statusCode, incident.body).toBe(201);
    const incidentId = incident.json().incidentId as string;
    await admin`insert into incident_boards (incident_id, board_id) values (${incidentId}, ${id})`;
    expect((await app.inject({ method: "GET", url: `${path}?incidentId=${incidentId}`, headers: auth(token) })).statusCode).toBe(404);
  });

  it("admin creates a board from the standard library and a member posts a record", async () => {
    const adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
    const create = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
      headers: auth(adminToken),
      payload: { templateKey: "significant_events" },
    });
    expect(create.statusCode).toBe(201);
    boardId = create.json().id as string;

    const memberToken = await tokenFor(app, "member@example.org", "another-good-password");
    const rec = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records`,
      headers: auth(memberToken),
      payload: {
        summary: "Bridge out on SR-169",
        occurred_at: "2026-09-17T10:00:00Z",
        severity: "critical",
      },
    });
    expect(rec.statusCode).toBe(201);

    const view = await app.inject({
      method: "GET",
      url: `/api/v1/boards/${boardId}/views/critical`,
      headers: auth(memberToken),
    });
    expect(view.statusCode).toBe(200);
    expect(view.json().records).toHaveLength(1);
    expect(view.json().records[0].summary).toBe("Bridge out on SR-169");
  });

  it("rejects records that violate the schema", async () => {
    const memberToken = await tokenFor(app, "member@example.org", "another-good-password");
    const bad = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records`,
      headers: auth(memberToken),
      payload: { summary: "x", occurred_at: "2026-09-17T10:00:00Z", severity: "catastrophic" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("enforces admin-only fields at write time", async () => {
    const memberToken = await tokenFor(app, "member@example.org", "another-good-password");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records`,
      headers: auth(memberToken),
      payload: {
        summary: "Verified event",
        occurred_at: "2026-09-17T11:00:00Z",
        severity: "warning",
        verified: true,
      },
    });
    expect(res.statusCode).toBe(403);
    const adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
    const ok = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records`,
      headers: auth(adminToken),
      payload: {
        summary: "Verified event",
        occurred_at: "2026-09-17T11:00:00Z",
        severity: "warning",
        verified: true,
      },
    });
    expect(ok.statusCode).toBe(201);
  });

  it("viewers read but cannot write", async () => {
    const viewerToken = await tokenFor(app, "viewer@example.org", "viewer-password-long");
    const view = await app.inject({
      method: "GET",
      url: `/api/v1/boards/${boardId}/views/all`,
      headers: auth(viewerToken),
    });
    expect(view.statusCode).toBe(200);
    const write = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records`,
      headers: auth(viewerToken),
      payload: { summary: "n", occurred_at: "2026-09-17T12:00:00Z", severity: "normal" },
    });
    expect(write.statusCode).toBe(403);
  });
});

describe("guest board scope (R3)", () => {
  it("a guest reads only the designated board, and outsiders see nothing", async () => {
    const adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
    await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/guests`,
      headers: auth(adminToken),
      payload: {
        personId: guestId,
        scopes: [`board:${boardId}:read`],
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const guestToken = await tokenFor(app, "guest@example.org", "guest-password-long");
    const view = await app.inject({
      method: "GET",
      url: `/api/v1/boards/${boardId}/views/all`,
      headers: auth(guestToken),
    });
    expect(view.statusCode).toBe(200);
    const write = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/records`,
      headers: auth(guestToken),
      payload: { summary: "g", occurred_at: "2026-09-17T12:00:00Z", severity: "normal" },
    });
    expect(write.statusCode).toBe(403);

    const outsiderToken = await tokenFor(app, "outsider@example.org", "outsider-password-1");
    const denied = await app.inject({
      method: "GET",
      url: `/api/v1/boards/${boardId}/views/all`,
      headers: auth(outsiderToken),
    });
    // RLS hides the board before the service can even say forbidden:
    // an outsider learns nothing, not even that the board exists.
    expect(denied.statusCode).toBe(404);
    const rows = await withPerson(
      runtime,
      outsiderId,
      (tx) => tx`select id from board_records`,
    );
    expect(rows).toHaveLength(0);
  });
});

describe("upgrade with preserved customization (INV-5)", () => {
  it("keeps local fields, adopts new template fields, and re-converges duplicates", async () => {
    const adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
    await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/local-fields`,
      headers: auth(adminToken),
      payload: { key: "x_tribal_notes", label: "Tribal notes", type: "text" },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/local-fields`,
      headers: auth(adminToken),
      payload: { key: "x_source", label: "Source", type: "text" },
    });

    const sig = STANDARD_TEMPLATES.find((t) => t.key === "significant_events")!;
    const v2 = {
      ...sig,
      version: 2,
      fields: [...sig.fields, { key: "source", label: "Source", type: "text" }],
    };
    const reg = await app.inject({
      method: "POST",
      url: "/api/v1/templates",
      headers: auth(adminToken),
      payload: v2,
    });
    expect(reg.statusCode).toBe(201);

    const before = await admin`select count(*)::int as n from board_records
      where board_id = ${boardId}`;
    const upgrade = await app.inject({
      method: "POST",
      url: `/api/v1/boards/${boardId}/upgrade`,
      headers: auth(adminToken),
      payload: { toVersion: 2 },
    });
    expect(upgrade.statusCode).toBe(200);
    expect(upgrade.json().dropped).toEqual(["x_source"]);

    const board = await app.inject({
      method: "GET",
      url: `/api/v1/boards/${boardId}`,
      headers: auth(adminToken),
    });
    const keys = board.json().fields.map((f: { key: string }) => f.key);
    expect(keys).toContain("source");
    expect(keys).toContain("x_tribal_notes");
    expect(keys).not.toContain("x_source");
    const after = await admin`select count(*)::int as n from board_records
      where board_id = ${boardId}`;
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});

describe("signed package import", () => {
  it("imports a trusted package and refuses a tampered one", async () => {
    const adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
    const custom = {
      ...STANDARD_TEMPLATES.find((t) => t.key === "shelters")!,
      key: "regional_shelters",
      version: 1,
    };
    const pkg = exportPackage([custom], "Test Region", signer.privateKeyPem, signer.publicKeyPem);
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/templates/import",
      headers: auth(adminToken),
      payload: pkg,
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().imported).toBe(1);

    const additional = {
      ...STANDARD_TEMPLATES.find((t) => t.key === "damage_assessment")!,
      key: "regional_damage_assessment",
      version: 1,
    };
    const mixed = exportPackage(
      [custom, additional],
      "Test Region",
      signer.privateKeyPem,
      signer.publicKeyPem,
    );
    const retried = await app.inject({
      method: "POST",
      url: "/api/v1/templates/import",
      headers: auth(adminToken),
      payload: mixed,
    });
    expect(retried.statusCode).toBe(201);
    expect(retried.json().imported).toBe(1);

    const tampered = structuredClone(pkg) as typeof pkg;
    (tampered.templates[0] as { title: string }).title = "Evil";
    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/templates/import",
      headers: auth(adminToken),
      payload: tampered,
    });
    expect(bad.statusCode).toBe(400);

    // An imported template creates no board; the catalogue lists it at its
    // latest version, and a board is then created from it.
    expect((await app.inject({ method: "GET", url: "/api/v1/templates" })).statusCode).toBe(401);
    const catalogue = await app.inject({ method: "GET", url: "/api/v1/templates", headers: auth(adminToken) });
    expect(catalogue.statusCode).toBe(200);
    const templates = catalogue.json().templates as Array<{ key: string; version: number; title: string }>;
    expect(templates).toContainEqual({ key: "regional_shelters", version: 1, title: custom.title });
    expect(templates.filter((t) => t.key === "shelters")).toHaveLength(1);
    const board = await app.inject({
      method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`, headers: auth(adminToken),
      payload: { templateKey: "regional_shelters", version: 1, title: "Regional shelters" },
    });
    expect(board.statusCode, board.body).toBe(201);
  });
});
