import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STANDARD_INCIDENT_TEMPLATES } from "../incidents/service.js";

/**
 * The console's Help bundles every position job aid from the training kit and
 * opens the acting position's: every aid file is in the web module the build
 * bundles, and every position the standard incident templates and the
 * shipped packs open has an aid, its own or the nearest.
 */

const TRAINING = fileURLToPath(new URL("../../../docs/guides/training/", import.meta.url));
const PACKS = fileURLToPath(new URL("../../../deploy/packs/", import.meta.url));

interface JobAidsModule {
  JOB_AIDS: ReadonlyArray<{ key: string; title: string; markdown: string }>;
  POSITION_AIDS: Readonly<Record<string, { aid: string; nearest?: true }>>;
  aidForPosition(position: { key: string; title: string }): { aid: { key: string }; nearest: boolean } | null;
}

// The web module, loaded by path so the server's compiler does not take in the web package.
const load = () => import("../../../web/src/help/" + "job-aids.js") as Promise<JobAidsModule>;

describe("position job aids", () => {
  it("bundles every job aid file in the training kit, each titled from its heading", async () => {
    const { JOB_AIDS } = await load();
    const files = readdirSync(TRAINING).filter((name) => /^JOB-AID-.+\.md$/.test(name)).sort();
    expect(files.length).toBeGreaterThan(0);
    expect(JOB_AIDS.map((aid) => `JOB-AID-${aid.key}.md`).sort()).toEqual(files);
    for (const aid of JOB_AIDS) {
      expect(aid.markdown).toBe(readFileSync(`${TRAINING}JOB-AID-${aid.key}.md`, "utf8"));
      expect(aid.markdown.split(/\r?\n/)[0]).toBe(`# Job Aid: ${aid.title}`);
    }
  });

  it("maps every position the standard templates and the packs open to an aid", async () => {
    const { JOB_AIDS, POSITION_AIDS, aidForPosition } = await load();
    const packs = readdirSync(PACKS, { withFileTypes: true }).filter((entry) => entry.isDirectory())
      .map((entry) => JSON.parse(readFileSync(`${PACKS}${entry.name}/package.json`, "utf8")) as
        { contents: { incidentTemplates?: Array<{ positions: string[] }> } });
    const positions = new Set([
      ...STANDARD_INCIDENT_TEMPLATES.flatMap((template) => template.positions),
      ...packs.flatMap((pack) => (pack.contents.incidentTemplates ?? []).flatMap((template) => template.positions)),
    ]);
    expect(positions.size).toBeGreaterThanOrEqual(8);
    for (const key of positions) expect(aidForPosition({ key, title: key }), key).not.toBeNull();
    // Each mapping names an aid that exists, and every aid but the field user's has a position.
    const keys = new Set(JOB_AIDS.map((aid) => aid.key));
    for (const [position, entry] of Object.entries(POSITION_AIDS)) expect(keys.has(entry.aid), position).toBe(true);
    const reached = new Set(Object.values(POSITION_AIDS).map((entry) => entry.aid));
    expect([...keys].filter((key) => !reached.has(key))).toEqual(["FIELD-USER"]);
  });
});
