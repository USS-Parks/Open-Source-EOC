import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { addMembership, createJurisdiction, createPerson } from "../auth/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";
import { multipartUpload } from "./multipart.js";
import { FIELD_SURVEY, FIELD_SURVEY_TEMPLATE, xlsFormWorkbook } from "./xlsform-workbook.js";

/**
 * Field depth against a real database: an XLSForm workbook with line,
 * polygon, barcode, photo, audio, cascading select and repeat questions
 * imports; the server refuses what the runner refuses; a capture lands on
 * the board with its geometries and repeat entries; and photo and audio
 * files attach to the created record through the file store.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: Awaited<ReturnType<typeof seedIdentity>>;
let adminToken: string;
let memberToken: string;
let outsiderToken: string;
let boardId: string;

const LINE = "40.80 -124.16;40.81 -124.17;40.82 -124.18";
const RING = "40.80 -124.16;40.81 -124.16;40.81 -124.17;40.80 -124.16";
const CAPTURE = {
  summary: "Culvert failure on Old Arcata Road", county: "humboldt", town: "arcata",
  route: LINE, area: RING, asset_tag: "CUL-0042",
  crews: [{ crew_name: "Engine 12", crew_size: 4 }, { crew_name: "Dozer 3", crew_size: 2 }],
};
// A one-pixel PNG and a minimal WAV header with a few samples.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wl9sAAAAASUVORK5CYII=", "base64");
const WAV = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.from([44, 0, 0, 0]), Buffer.from("WAVEfmt ", "ascii"),
  Buffer.from([16, 0, 0, 0, 1, 0, 1, 0, 64, 31, 0, 0, 64, 31, 0, 0, 1, 0, 8, 0]), Buffer.from("data", "ascii"),
  Buffer.from([8, 0, 0, 0, 128, 128, 128, 128, 128, 128, 128, 128])]);

function submit(answers: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/v1/forms/field_survey/submit",
    headers: auth(memberToken),
    payload: { jurisdictionId: seed.jurisdictionId, boardId, answers },
  });
}

async function attach(recordId: string, question: string, name: string, content: Buffer, type: string, token = memberToken) {
  const body = await multipartUpload({ question, name }, content, type);
  return app.inject({
    method: "POST",
    url: `/api/v1/forms/records/${recordId}/attachments`,
    headers: { ...auth(token), ...body.headers },
    payload: body.payload,
  });
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  // Publishing a board template is an instance administrator's act.
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  const other = await createJurisdiction(admin, "humboldt", "Humboldt County OES");
  const outsider = await createPerson(admin, { email: "outsider@example.org", displayName: "Outsider", password: "a-third-good-password" });
  await addMembership(admin, outsider, other, "member");
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
  outsiderToken = await tokenFor(app, "outsider@example.org", "a-third-good-password");
  const template = await app.inject({ method: "POST", url: "/api/v1/templates", headers: auth(adminToken), payload: FIELD_SURVEY_TEMPLATE });
  expect(template.statusCode).toBe(201);
  const board = await app.inject({
    method: "POST",
    url: `/api/v1/jurisdictions/${seed.jurisdictionId}/boards`,
    headers: auth(adminToken),
    payload: { templateKey: FIELD_SURVEY_TEMPLATE.key },
  });
  boardId = board.json().id as string;
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

describe("importing an XLSForm with every field depth type", () => {
  it("stores line, polygon, barcode, photo, audio, a cascading select and a repeat", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/forms/import`,
      headers: auth(adminToken),
      payload: { key: "field_survey", boardTemplate: FIELD_SURVEY_TEMPLATE.key, xlsxBase64: xlsFormWorkbook(FIELD_SURVEY).toString("base64") },
    });
    expect(res.statusCode).toBe(201);
    const form = (await app.inject({
      method: "GET", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/forms/field_survey`, headers: auth(memberToken),
    })).json() as { title: string; nodes: Array<{ name: string; kind: string; type?: string; choiceFilter?: string; children?: unknown[] }> };
    expect(form.title).toBe("Field damage survey");
    expect(form.nodes.map((node) => node.type ?? node.kind)).toEqual([
      "text", "select_one", "select_one", "geotrace", "geoshape", "barcode", "image", "audio", "repeat",
    ]);
    expect(form.nodes.find((node) => node.name === "town")!.choiceFilter).toBe("county=${county}");
    expect(form.nodes.find((node) => node.name === "crews")!.children).toHaveLength(2);
  });

  it("refuses a workbook with an unsupported construct, naming its row", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/forms/import`,
      headers: auth(adminToken),
      payload: { key: "ranged", xlsxBase64: xlsFormWorkbook({
        survey: [{ type: "text", name: "note_text", label: "Note" }, { type: "range", name: "severity", label: "Severity" }],
        choices: [],
      }).toString("base64") },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("survey row 3: question type 'range' is not supported");
  });

  it("refuses a form definition whose expressions the runner cannot evaluate", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/jurisdictions/${seed.jurisdictionId}/forms`,
      headers: auth(adminToken),
      payload: { key: "dated", version: 1, title: "Dated", nodes: [
        { kind: "field", name: "when", type: "text", relevant: "today() > 0" },
      ] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("question 'when' relevant: unsupported function 'today()'");
  });
});

describe("submitting a field depth capture", () => {
  let recordId: string;

  it("lands the line, the polygon, the barcode and the repeat entries on the board", async () => {
    const res = await submit(CAPTURE);
    expect(res.statusCode).toBe(201);
    recordId = res.json().recordId as string;
    const [row] = await admin`
      select data, ST_AsText(geom) as geom from board_records where id = ${recordId}`;
    const data = row!.data as Record<string, unknown>;
    expect(data.route).toEqual({ type: "LineString", coordinates: [[-124.16, 40.8], [-124.17, 40.81], [-124.18, 40.82]] });
    expect(data.area).toEqual({ type: "Polygon", coordinates: [[[-124.16, 40.8], [-124.16, 40.81], [-124.17, 40.81], [-124.16, 40.8]]] });
    expect(row!.geom).toBe("LINESTRING(-124.16 40.8,-124.17 40.81,-124.18 40.82)");
    expect(data).toMatchObject({ county: "humboldt", town: "arcata", asset_tag: "CUL-0042" });
    expect(JSON.parse(data.crews as string)).toEqual(CAPTURE.crews);
  });

  it("refuses invalid geometry, a filtered-out choice and a malformed repeat", async () => {
    const refused = async (answers: Record<string, unknown>) => {
      const res = await submit({ ...CAPTURE, ...answers });
      expect(res.statusCode).toBe(422);
      return res.json().errors as Array<{ field: string; message: string }>;
    };
    expect(await refused({ route: "40.8 -124.16" }))
      .toEqual([{ field: "route", message: "a line needs at least 2 points" }]);
    expect(await refused({ area: "40.80 -124.16;40.81 -124.16;40.81 -124.17" }))
      .toEqual([{ field: "area", message: "a polygon must be closed: repeat the first point last" }]);
    expect(await refused({ town: "klamath" }))
      .toEqual([{ field: "town", message: "not an allowed choice" }]);
    expect(await refused({ crews: { crew_name: "Engine 12" } }))
      .toEqual([{ field: "crews", message: "must be a list of entries" }]);
    expect(await refused({ crews: [{ crew_size: -1 }] })).toEqual([
      { field: "crews[0].crew_name", message: "required" },
      { field: "crews[0].crew_size", message: "at least one person" },
    ]);
  });

  it("attaches photo and audio answers to the created record and its attachment fields", async () => {
    const photo = await attach(recordId, "photo", "culvert.png", PNG, "image/png");
    expect(photo.statusCode).toBe(201);
    expect(photo.json().field).toBe("photo");
    const voice = await attach(recordId, "voice_note", "voice-note.wav", WAV, "audio/wav");
    expect(voice.statusCode).toBe(201);
    const nested = await attach(recordId, "crews[1].photo", "dozer.png", PNG, "image/png");
    expect(nested.statusCode).toBe(201);
    expect(nested.json().field).toBeNull(); // attached to the record, no board field of that name

    const files = await admin`
      select id, name, content_type, attached_kind, attached_id, jurisdiction_id
      from files where attached_id = ${recordId} order by created_at`;
    expect(files.map((file) => [file.name, file.content_type, file.attached_kind])).toEqual([
      ["culvert.png", "image/png", "record"], ["voice-note.wav", "audio/wav", "record"], ["dozer.png", "image/png", "record"],
    ]);
    expect(files.every((file) => file.jurisdiction_id === seed.jurisdictionId)).toBe(true);
    const [row] = await admin`select data from board_records where id = ${recordId}`;
    expect((row!.data as Record<string, unknown>).photo).toBe(photo.json().id);
    expect((row!.data as Record<string, unknown>).voice_note).toBe(voice.json().id);
  });

  it("refuses an attachment of another type, for a missing record, or from outside the jurisdiction", async () => {
    const text = await attach(recordId, "photo", "notes.txt", Buffer.from("not a photo"), "text/plain");
    expect(text.statusCode).toBe(400);
    expect(text.json().error).toMatch(/^photo and audio answers accept/);
    const missing = await attach("00000000-0000-4000-8000-000000000000", "photo", "culvert.png", PNG, "image/png");
    expect(missing.statusCode).toBe(404);
    const outsider = await attach(recordId, "photo", "culvert.png", PNG, "image/png", outsiderToken);
    expect(outsider.statusCode).toBe(404);
    const badQuestion = await attach(recordId, "photo; drop", "culvert.png", PNG, "image/png");
    expect(badQuestion.statusCode).toBe(400);
    const [{ count }] = await admin`select count(*)::int as count from files where attached_id = ${recordId}` as unknown as [{ count: number }];
    expect(count).toBe(3);
  });
});
