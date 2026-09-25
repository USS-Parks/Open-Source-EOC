import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { ensureScenarioTemplates, SCENARIO_INCIDENT_TEMPLATES } from "../demo/scenario-templates.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let adminToken: string;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  ({ jurisdictionId } = await seedIdentity(admin));
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  await ensureScenarioTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
});

afterAll(async () => {
  await app.close();
  await runtime.end();
  await admin.end();
});

describe("the exercise scenarios' activation templates", () => {
  for (const template of SCENARIO_INCIDENT_TEMPLATES) {
    it(`${template.title} activates with its positions, boards and checklists`, async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
        headers: auth(adminToken),
        payload: { templateKey: template.key, name: `${template.title} drill`, kind: "exercise" },
      });
      expect(res.statusCode).toBe(201);
      const result = res.json();
      expect(result.positions).toBe(8);
      expect(result.boards).toBe(template.boards.length);
      expect(result.checklistItems).toBe(template.checklists.reduce((sum, list) => sum + list.items.length, 0));
      const boards = await admin`
        select b.template_key from boards b join incident_boards ib on ib.board_id = b.id
        where ib.incident_id = ${result.incidentId as string}`;
      expect(boards.map((board) => board.template_key).sort()).toEqual([...template.boards].sort());
    });
  }

  it("leaves a stored copy of a template alone when run again", async () => {
    await admin`update incident_templates set title = 'Local flood' where key = 'flood'`;
    await ensureScenarioTemplates(admin);
    const [row] = await admin`select title from incident_templates where key = 'flood'`;
    expect(row!.title).toBe("Local flood");
  });
});
