import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importXlsForm, STANDARD_TEMPLATES } from "@openeoc/shared";
import { buildApp } from "../app.js";
import { generateSigningKeyPair } from "../boards/package.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { signSolutionPackage, verifySolutionPackage, type SignedPackage } from "../data-packs/solution.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { newPackageKeyCommand, signPackageCommand } from "../main.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * VA11: a signed solution package carries board, incident, dashboard, report
 * and rule templates and forms. Imported on a fresh profile it creates each
 * part; imported again it changes nothing; a package changed after signing,
 * or signed by a key the instance does not trust, is refused and imports
 * nothing; a part that collides with what the instance holds refuses the
 * whole package; an incident template edited on screen is kept.
 */

const publisher = generateSigningKeyPair();
const stranger = generateSigningKeyPair();
const work = mkdtempSync(join(tmpdir(), "openeoc-solution-"));
let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let adminToken: string;
let memberToken: string;
let priorKeys: string | undefined;

const shelters = STANDARD_TEMPLATES.find((template) => template.key === "shelters")!;
const form = importXlsForm({
  survey: [
    { type: "text", name: "name", label: "Shelter", required: "yes" },
    { type: "integer", name: "occupancy", label: "Occupancy" },
  ],
  choices: [],
}, { key: "shelter_count", title: "Shelter count", boardTemplate: "tribal_shelter_log" });

function content(overrides: Record<string, unknown> = {}) {
  return {
    publisher: "Klamath River Test Region",
    name: "Tribal EOC starter",
    version: "2026.1",
    contents: {
      boardTemplates: [{ ...shelters, key: "tribal_shelter_log", version: 1, title: "Tribal shelter log" }],
      incidentTemplates: [{
        key: "tribal_flood", title: "River flood",
        positions: ["incident_commander", "tribal_liaison"],
        positionTitles: { tribal_liaison: "Tribal Liaison" },
        boards: ["tribal_shelter_log", "resource_request"],
        checklists: [{ position: "incident_commander", items: ["Open the EOC", "Brief the council"] }],
      }],
      forms: [form],
      dashboardTemplates: [{
        key: "tribal_overview", version: 1, title: "Flood overview",
        widgets: [{ kind: "tile", key: "open_shelters", title: "Shelters", board: "tribal_shelter_log" }],
      }],
      reportTemplates: [{
        key: "shelter_daily", version: 1, title: "Daily shelter count", board: "tribal_shelter_log",
        definition: { columns: ["name", "status", "occupancy"], totals: [{ field: "occupancy", fn: "sum" }] },
        schedule: { cadence: { kind: "daily", time: "07:00", timeZone: "America/Los_Angeles" }, format: "pdf" },
      }],
      ruleTemplates: [{
        key: "new_shelter_notice", version: 1, title: "A shelter opens", board: "tribal_shelter_log",
        event: "record.created",
        channels: [
          { kind: "position", position: "incident_commander", via: ["inapp"] },
          { kind: "group", group: "Tribal Council", via: ["email", "sms"] },
        ],
      }],
      ...overrides,
    },
  };
}

const post = (pkg: unknown, token = adminToken) => app.inject({
  method: "POST", url: `/api/v1/jurisdictions/${jurisdictionId}/solution-packages`, headers: auth(token), payload: pkg as object,
});

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await admin`update persons set is_instance_admin = true where id = ${seed.adminId}`;
  // A fresh profile, as the server prepares one.
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  writeFileSync(join(work, "publishers.pem"), `${publisher.publicKeyPem}\n`);
  priorKeys = process.env.OPENEOC_TRUSTED_TEMPLATE_KEYS;
  process.env.OPENEOC_TRUSTED_TEMPLATE_KEYS = join(work, "publishers.pem");
  app = buildApp(runtime, { oidc: null });
  adminToken = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  memberToken = await tokenFor(app, "member@example.org", "another-good-password");
});

afterAll(async () => {
  if (priorKeys === undefined) delete process.env.OPENEOC_TRUSTED_TEMPLATE_KEYS;
  else process.env.OPENEOC_TRUSTED_TEMPLATE_KEYS = priorKeys;
  rmSync(work, { recursive: true, force: true });
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("signed solution packages", () => {
  it("makes a key and signs a package from the command line, refusing to overwrite a key or the input", () => {
    const lines: string[] = [];
    const privateKey = join(work, "publisher.key.pem");
    const publicKey = join(work, "publisher.pub.pem");
    newPackageKeyCommand(["--private", privateKey, "--public", publicKey], (line) => lines.push(line));
    expect(() => newPackageKeyCommand(["--private", privateKey, "--public", join(work, "other.pem")])).toThrow(/already exists/);
    writeFileSync(join(work, "starter.json"), JSON.stringify(content()));
    expect(() => signPackageCommand(["--key", privateKey, "--in", join(work, "starter.json"), "--out", join(work, "starter.json")]))
      .toThrow(/must name a new file/);
    const signed = signPackageCommand(["--key", privateKey, "--in", join(work, "starter.json"), "--out", join(work, "signed.json")],
      (line) => lines.push(line), new Date("2026-09-25T20:00:00Z"));
    expect(lines.at(-1)).toMatch(/^Signed Tribal EOC starter 2026\.1 for Klamath River Test Region: 6 item\(s\), key [0-9a-f]{16}\. Wrote /);
    const written = JSON.parse(readFileSync(join(work, "signed.json"), "utf8")) as SignedPackage;
    expect(written).toEqual(signed);
    expect(verifySolutionPackage(written, [readFileSync(publicKey, "utf8")]).package.publishedAt).toBe("2026-09-25T20:00:00.000Z");
    // An invalid package is refused before it is signed, where the publisher can fix it.
    writeFileSync(join(work, "bad.json"), JSON.stringify(content({ reportTemplates: [{ key: "Bad Key" }] })));
    expect(() => signPackageCommand(["--key", privateKey, "--in", join(work, "bad.json"), "--out", join(work, "bad.signed.json")]))
      .toThrow(/contents\.reportTemplates\.0/);
  });

  it("imports each part of a signed package on a fresh profile, and nothing again the second time", async () => {
    const pkg = signSolutionPackage(content(), publisher.privateKeyPem);
    const first = await post(pkg);
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().parts).toEqual({
      boardTemplates: { created: ["tribal_shelter_log version 1"], held: [], kept: [] },
      incidentTemplates: { created: ["tribal_flood"], held: [], kept: [] },
      forms: { created: ["shelter_count version 1"], held: [], kept: [] },
      dashboardTemplates: { created: ["tribal_overview version 1"], held: [], kept: [] },
      reportTemplates: { created: ["shelter_daily version 1"], held: [], kept: [] },
      ruleTemplates: { created: ["new_shelter_notice version 1"], held: [], kept: [] },
    });
    expect(await admin`select key from board_templates where key = 'tribal_shelter_log'`).toHaveLength(1);
    const [incident] = await admin`select version, definition from incident_templates where key = 'tribal_flood'`;
    expect(incident).toMatchObject({ version: 1, definition: { positionTitles: { tribal_liaison: "Tribal Liaison" } } });
    expect(await admin`select key from form_definitions where jurisdiction_id = ${jurisdictionId} and key = 'shelter_count'`).toHaveLength(1);
    expect(await admin`select key from dashboard_templates where key = 'tribal_overview'`).toHaveLength(1);
    const [report] = await admin`select definition from report_templates where key = 'shelter_daily'`;
    expect(report!.definition).toMatchObject({ board: "tribal_shelter_log", definition: { columns: ["name", "status", "occupancy"] } });
    const [rule] = await admin`select definition from rule_templates where key = 'new_shelter_notice'`;
    expect(rule!.definition).toMatchObject({ channels: [{ kind: "position", position: "incident_commander" }, { kind: "group", group: "Tribal Council" }] });
    // An incident activates from the imported template, with its positions and boards.
    const activated = await app.inject({ method: "POST", url: `/api/v1/jurisdictions/${jurisdictionId}/incidents`, headers: auth(adminToken),
      payload: { templateKey: "tribal_flood", name: "Klamath River rise" } });
    expect(activated.statusCode, activated.body).toBe(201);

    const again = await post(pkg);
    expect(again.statusCode, again.body).toBe(201);
    for (const part of Object.values(again.json().parts as Record<string, { created: string[]; held: string[] }>)) {
      expect(part.created).toEqual([]);
      expect(part.held).toHaveLength(1);
    }
    const imports = await app.inject({ method: "GET", url: "/api/v1/solution-packages", headers: auth(adminToken) });
    expect(imports.json().packages.map((p: { name: string; importedBy: string }) => [p.name, p.importedBy]))
      .toEqual([["Tribal EOC starter", "Admin"], ["Tribal EOC starter", "Admin"]]);
    const [audit] = await admin`select payload from audit_events where category = 'package.imported' order by seq limit 1`;
    expect(audit!.payload).toMatchObject({ name: "Tribal EOC starter", created: { boardTemplates: 1, ruleTemplates: 1 } });
  });

  it("refuses a package changed after signing, or signed by an untrusted key, and imports nothing", async () => {
    const extra = content({ reportTemplates: [{ key: "shelter_weekly", version: 1, title: "Weekly", board: "shelters", definition: { columns: ["name"] } }] });
    const tampered = signSolutionPackage(extra, publisher.privateKeyPem);
    (tampered.contents.reportTemplates[0] as { title: string }).title = "Weekly, changed";
    const refused = await post(tampered);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toMatch(/changed after it was signed/);
    const untrusted = await post(signSolutionPackage(extra, stranger.privateKeyPem));
    expect(untrusted.statusCode).toBe(400);
    expect(untrusted.json().error).toMatch(/key this instance does not trust/);
    expect(await admin`select 1 from report_templates where key = 'shelter_weekly'`).toHaveLength(0);
    // Only an instance administrator who administers the jurisdiction imports.
    expect((await post(signSolutionPackage(extra, publisher.privateKeyPem), memberToken)).statusCode).toBe(403);
    expect(await admin`select 1 from report_templates where key = 'shelter_weekly'`).toHaveLength(0);
  });

  it("refuses a whole package when a part collides with the instance or names a board template no one has", async () => {
    const collides = content({
      boardTemplates: [{ ...shelters, key: "tribal_shelter_log", version: 1, title: "Another region's shelter log" }],
      ruleTemplates: [{ key: "new_rule", version: 1, title: "New", board: null, event: "scheduled", scheduleIntervalMinutes: 60,
        channels: [{ kind: "inapp", target: "requesting_position" }] }],
    });
    const conflict = await post(signSolutionPackage(collides, publisher.privateKeyPem));
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toMatch(/board template tribal_shelter_log version 1 is already on this instance with different content/);
    const missing = await post(signSolutionPackage(content({
      boardTemplates: [], ruleTemplates: [{ key: "new_rule", version: 1, title: "New", board: "no_such_board", event: "record.created",
        channels: [{ kind: "inapp", target: "requesting_position" }] }],
    }), publisher.privateKeyPem));
    expect(missing.statusCode).toBe(409);
    expect(missing.json().error).toMatch(/no board template no_such_board/);
    expect(await admin`select 1 from rule_templates where key = 'new_rule'`).toHaveLength(0);
    // A report or rule naming a field its board template lacks would fail at every activation; it is refused here.
    const badFields = await post(signSolutionPackage(content({
      boardTemplates: [],
      reportTemplates: [{ key: "bad_report", version: 1, title: "Bad", board: "shelters",
        definition: { columns: ["name", "beds"], totals: [{ field: "status", fn: "sum" }] } }],
      ruleTemplates: [{ key: "bad_rule", version: 1, title: "Bad", board: "shelters", event: "record.updated",
        condition: { field: "colour", op: "eq", value: "red" }, channels: [{ kind: "inapp", target: "requesting_position" }] }],
    }), publisher.privateKeyPem));
    expect(badFields.statusCode).toBe(409);
    expect(badFields.json().error).toContain("report template bad_report version 1 names beds, which board template shelters does not have");
    expect(badFields.json().error).toContain("report template bad_report version 1 totals status, which is not a number");
    expect(badFields.json().error).toContain("rule template bad_rule version 1 watches colour, which board template shelters does not have");
    expect(await admin`select 1 from report_templates where key = 'bad_report'`).toHaveLength(0);
  });

  it("keeps an incident template the instance has edited since", async () => {
    const edited = await app.inject({ method: "PUT", url: "/api/v1/incident-templates/tribal_flood", headers: auth(adminToken),
      payload: { expectedVersion: 1, template: { ...content().contents.incidentTemplates[0], title: "River flood, local" } } });
    expect(edited.statusCode, edited.body).toBe(200);
    const result = await post(signSolutionPackage(content(), publisher.privateKeyPem));
    expect(result.statusCode, result.body).toBe(201);
    expect(result.json().parts.incidentTemplates).toEqual({ created: [], held: [], kept: ["tribal_flood"] });
    const [row] = await admin`select version, title from incident_templates where key = 'tribal_flood'`;
    expect(row).toMatchObject({ version: 2, title: "River flood, local" });
  });
});
