import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardDashboards } from "../dashboards/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type SeedResult, type Sql } from "./helpers.js";
import { multipartUpload } from "./multipart.js";

/**
 * The incident room (VC-12): an incident template names dashboards, message
 * threads and file folders, a save is held to what activation can make, and
 * activation makes each in its own transaction. Dashboards listed for an
 * incident put its own first and leave out other incidents'; an
 * incident-wide thread and a position thread reach their readers; a file
 * filed in a folder is attached to the folder's incident, in the service and
 * in the database.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let seed: SeedResult;
let adminToken: string;
let memberToken: string;

beforeAll(async () => {
  process.env.OPENEOC_DATA_DIR = mkdtempSync(join(tmpdir(), "openeoc-room-"));
  ({ admin, runtime } = await freshDb());
  seed = await seedIdentity(admin);
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  await ensureStandardTemplates(admin);
  await ensureStandardDashboards(admin);
  // The member holds Operations before any incident, so the Operations thread reaches them.
  const [operations] = await admin`
    insert into positions (jurisdiction_id, key, title)
    values (${seed.jurisdictionId}, 'operations_section_chief', 'Operations Section Chief') returning id`;
  await admin`
    insert into position_assignments (position_id, person_id, assigned_by)
    values (${operations!.id as string}, ${seed.memberId}, ${seed.adminId})`;
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
});

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

const ROOM = {
  title: "River Flood",
  positions: ["incident_commander", "operations_section_chief"],
  boards: ["activity_log", "significant_events"],
  checklists: [],
  dashboards: ["eoc_status"],
  threads: [{ title: "EOC coordination" }, { title: "Operations", positions: ["operations_section_chief"] }],
  fileFolders: ["Situation reports", "Maps"],
};

const saveTemplate = (key: string, template: Record<string, unknown>) => app.inject({
  method: "PUT", url: `/api/v1/incident-templates/${key}`, headers: auth(adminToken), payload: { expectedVersion: 0, template },
});
const activate = (name: string) => app.inject({
  method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/incidents`, headers: auth(adminToken),
  payload: { templateKey: "river_flood", name },
});
const get = (url: string, token = memberToken) => app.inject({ method: "GET", url, headers: auth(token) });
async function upload(name: string, fields: Record<string, string>) {
  const body = await multipartUpload({ name, ...fields }, `${name} contents`, "text/plain");
  return app.inject({
    method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/files`,
    headers: { ...auth(memberToken), ...body.headers }, payload: body.payload,
  });
}

describe("the incident room", () => {
  it("saves a template naming dashboards, threads and folders, and refuses parts activation could not make", async () => {
    const refused = async (template: Record<string, unknown>) => {
      const response = await saveTemplate("room_check", { ...ROOM, ...template });
      expect(response.statusCode).toBe(400);
      return response.json().error as string;
    };
    expect(await refused({ dashboards: ["eoc_status", "levee_watch"] })).toBe("dashboards: no dashboard template levee_watch");
    expect(await refused({ dashboards: ["eoc_status", "eoc_status"] })).toBe("dashboards: a dashboard template is listed twice");
    expect(await refused({ threads: [{ title: "Safety", positions: ["safety_officer"] }] }))
      .toBe("threads: safety_officer in Safety is not one of the template's positions");
    expect(await refused({ threads: [{ title: "Command" }, { title: "Command" }] })).toBe("threads: Command is listed twice");
    expect(await refused({ fileFolders: ["Maps", "Situation reports", "Maps"] })).toBe("fileFolders: Maps is listed twice");
    expect(await admin`select 1 from incident_templates where key = 'room_check'`).toHaveLength(0);

    const saved = await saveTemplate("river_flood", ROOM);
    expect(saved.statusCode, saved.body).toBe(201);
    const read = await get("/api/v1/incident-templates/river_flood");
    expect(read.json().template).toMatchObject({
      dashboards: ["eoc_status"],
      threads: [{ title: "EOC coordination", positions: [] }, { title: "Operations", positions: ["operations_section_chief"] }],
      fileFolders: ["Situation reports", "Maps"],
    });
  });

  it("opens the incident's dashboards, threads and folders at activation, each where its screen reads it", async () => {
    const shared = await app.inject({
      method: "POST", url: `/api/v1/jurisdictions/${seed.jurisdictionId}/dashboards`, headers: auth(adminToken),
      payload: { templateKey: "eoc_status", title: "Jurisdiction status" },
    });
    expect(shared.statusCode, shared.body).toBe(201);
    const opened = await activate("Klamath Flood");
    expect(opened.statusCode, opened.body).toBe(201);
    expect(opened.json()).toMatchObject({ positions: 2, boards: 2, dashboards: 1, threads: 2, fileFolders: 2 });
    const incidentId = opened.json().incidentId as string;
    const other = await activate("Coastal Surge");
    const otherId = other.json().incidentId as string;

    // Dashboards: the incident's own first, the jurisdiction's after, another incident's left out.
    const titles = async (query: string) =>
      ((await get(`/api/v1/jurisdictions/${seed.jurisdictionId}/dashboards${query}`)).json().dashboards as Array<{ title: string }>)
        .map((dashboard) => dashboard.title);
    expect(await titles(`?incidentId=${incidentId}`)).toEqual(["Klamath Flood: EOC Status", "Jurisdiction status"]);
    expect(await titles(`?incidentId=${otherId}`)).toEqual(["Coastal Surge: EOC Status", "Jurisdiction status"]);
    expect(await titles("")).toEqual(["Coastal Surge: EOC Status", "Jurisdiction status", "Klamath Flood: EOC Status"]);

    // Threads: one read by everyone on the incident, one reaching the Operations holder.
    const threads = (await get(`/api/v1/incidents/${incidentId}/threads`)).json().threads as Array<{
      title: string; audience: string; recipients: Array<{ kind: string; label: string; currentHolders: string[] }>;
    }>;
    expect(threads.map((thread) => [thread.title, thread.audience]).sort()).toEqual([["EOC coordination", "incident"], ["Operations", "members"]]);
    expect(threads.find((thread) => thread.title === "Operations")!.recipients).toContainEqual(
      expect.objectContaining({ kind: "position", label: "Operations Section Chief", currentHolders: ["Member"] }));

    // Folders: in the template's order, empty, for the owner's members.
    const folders = (await get(`/api/v1/incidents/${incidentId}/file-folders`)).json().folders as Array<{ id: string; name: string; files: number }>;
    expect(folders.map((folder) => [folder.name, folder.files])).toEqual([["Situation reports", 0], ["Maps", 0]]);
    const maps = folders[1]!.id;

    const filed = await upload("levee-map.txt", { folderId: maps });
    expect(filed.statusCode, filed.body).toBe(201);
    const meta = (await get(`/api/v1/files/${filed.json().id as string}`)).json();
    expect(meta).toMatchObject({ attachedKind: "incident", attachedId: incidentId, folderId: maps, folderName: "Maps" });
    const loose = await upload("loose-note.txt", { attachedKind: "incident", attachedId: incidentId });
    expect(loose.statusCode).toBe(201);
    const inMaps = (await get(`/api/v1/jurisdictions/${seed.jurisdictionId}/files?attachedKind=incident&attachedId=${incidentId}&folderId=${maps}`)).json();
    expect(inMaps.files.map((file: { name: string }) => file.name)).toEqual(["levee-map.txt"]);
    expect(((await get(`/api/v1/incidents/${incidentId}/file-folders`)).json().folders as Array<{ files: number }>).map((f) => f.files)).toEqual([0, 1]);

    // A folder file is the folder's incident's: another attachment is refused, and so is an unknown folder.
    const elsewhere = await upload("stray.txt", { folderId: maps, attachedKind: "incident", attachedId: otherId });
    expect(elsewhere.statusCode).toBe(400);
    expect(elsewhere.json().error).toBe("a file in a folder is attached to the folder's incident");
    const unknown = await upload("stray.txt", { folderId: "00000000-0000-4000-8000-000000000000" });
    expect(unknown.json().error).toBe("folder not found in this jurisdiction");
    // The database holds it too, whatever path writes the row.
    await expect(admin`
      insert into files (jurisdiction_id, name, content_type, size, sha256, attached_kind, attached_id, folder_id, uploaded_by)
      values (${seed.jurisdictionId}, 'direct.txt', 'text/plain', 1, 'x', 'incident', ${otherId}, ${maps}, ${seed.adminId})`)
      .rejects.toThrow(/files_folder_incident/);
  });
});
