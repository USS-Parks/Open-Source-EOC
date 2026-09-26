import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * Smart forms (F7): a real XLSForm .xlsx imports, and a capture
 * runs through the form logic and lands on a board with geometry. The
 * offline runner semantics (relevance, calculations, constraints) are
 * proven exhaustively in the shared package; here we prove the binary
 * import and the capture-to-board-with-geometry path against a real DB.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;
let boardId: string;

/**
 * A representative PDA-style XLSForm workbook, checked in as a real .xlsx so
 * the reader is proven against a file it did not produce itself. Its survey
 * carries text, select_one, geopoint and note questions; its choices sheet
 * carries the closure_status list; its settings sheet carries the title.
 */
function pdaWorkbookBase64(): string {
  const path = join(import.meta.dirname, "fixtures", "xlsform-road-closure.xlsx");
  return readFileSync(path).toString("base64");
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await ensureStandardTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });

  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  const board = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { templateKey: "road_closures" },
  });
  boardId = board.json().id as string;
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});


describe("importing a real XLSForm workbook", () => {
  it("parses the survey, choices, and settings sheets into a stored form", async () => {
    const xlsxBase64 = pdaWorkbookBase64();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/forms/import`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { key: "closure_report", boardTemplate: "road_closures", xlsxBase64 },
    });
    expect(res.statusCode).toBe(201);
    // The import keeps its report for sign-off (VC-13).
    expect(res.json()).toEqual({ key: "closure_report", version: 1, reportId: expect.any(String) });

    const fetched = await app.inject({
      method: "GET",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/forms/closure_report`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    const def = fetched.json() as {
      title: string;
      nodes: Array<{ name: string; type?: string; choices?: { name: string }[] }>;
    };
    expect(def.title).toBe("Road Closure Report");
    const status = def.nodes.find((n) => n.name === "status")!;
    expect(status.type).toBe("select_one");
    expect(status.choices?.map((c) => c.name)).toEqual(["closed", "one_lane", "reopened"]);

    // Import is admin-only.
    const denied = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/forms/import`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { key: "sneaky", xlsxBase64 },
    });
    expect(denied.statusCode).toBe(403);
  });

  it("refuses an unreadable workbook with the reason, not a server error", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/forms/import`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { key: "broken", xlsxBase64: Buffer.from("not a workbook").toString("base64") },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/^not a readable \.xlsx workbook/);
  });
});

describe("submitting a capture", () => {
  it("lands on the board with geometry and masked fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/forms/closure_report/submit",
      headers: { authorization: `Bearer ${memberToken}` },
      payload: {
        jurisdictionId: seed.jurisdictionId,
        boardId,
        answers: {
          road: "SR-169 at Pecwan",
          reason: "landslide",
          status: "closed",
          location: "41.29 -123.61 0 5",
        },
      },
    });
    expect(res.statusCode).toBe(201);
    const recordId = res.json().recordId as string;

    const [row] = await admin`
      select data, ST_AsText(geom) as geom from board_records where id = ${recordId}`;
    expect((row!.data as Record<string, unknown>).road).toBe("SR-169 at Pecwan");
    expect((row!.data as Record<string, unknown>).status).toBe("closed");
    // The geopoint became the board's geometry (lon lat order).
    expect(row!.geom).toBe("POINT(-123.61 41.29)");
  });

  it("rejects a capture that fails form validation with the field errors", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/forms/closure_report/submit",
      headers: { authorization: `Bearer ${memberToken}` },
      payload: {
        jurisdictionId: seed.jurisdictionId,
        boardId,
        answers: { reason: "no road named", status: "closed", location: "41.29 -123.61" },
      },
    });
    expect(res.statusCode).toBe(422);
    const errors = res.json().errors as Array<{ field: string; message: string }>;
    expect(errors).toContainEqual({ field: "road", message: "required" });
  });
});
