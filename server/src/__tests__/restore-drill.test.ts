import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { migrate } from "../db/migrate.js";
import { ensureDemoData, type DemoResult } from "../demo/seed.js";
import { auth, freshDb, tokenFor, type Sql, type TestDb } from "./helpers.js";

/**
 * The restore drill. A synthetic activation is dumped with pg_dump the way
 * deploy/backup.sh and the desktop launcher's pre-upgrade backup dump it, and
 * replayed with psql into a second database the way deploy/restore.sh and the
 * upgrade guide replay it: in one transaction that drops the public schema
 * and runs the dump, stopping at the first error. Every row of every table,
 * every sequence and the migration history must come back each time, the
 * migration runner must find nothing to do, and the app must serve the
 * restored records under the runtime role. The dump size and the dump and
 * restore times are printed for the upgrade guide.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const MIGRATIONS = join(ROOT, "server/migrations");
const LOG_LINES = 4000;
const ROAD_CLOSURES = 1000;
const FILES = 200;
const DROP_SCHEMA = "drop schema public cascade; create schema public;";

// The PostgreSQL client tools of the local runtime (OPENEOC_PG_DIST, as the
// desktop launcher reads it) when present, otherwise from PATH.
const PG_BIN = join(process.env.OPENEOC_PG_DIST ?? join(ROOT, "deploy/test-runtime/out/pgsql"), "bin");
const pgTool = (name: string): string => {
  const local = join(PG_BIN, process.platform === "win32" ? `${name}.exe` : name);
  return existsSync(local) ? local : name;
};

/** libpq settings for the cluster the test databases live in, as db/client.ts connects. */
function pgEnv(): NodeJS.ProcessEnv {
  const url = process.env.OPENEOC_DATABASE_URL;
  if (!url) {
    return {
      ...process.env,
      PGHOST: process.env.OPENEOC_PG_SOCKET ?? "/tmp/pg",
      PGPORT: process.env.OPENEOC_PG_PORT ?? "5433",
      PGUSER: process.env.OPENEOC_PG_USER ?? "postgres",
    };
  }
  const u = new URL(url);
  return {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
  };
}

function pg(tool: string, args: string[], input?: Buffer): { stdout: Buffer; ms: number } {
  const t0 = performance.now();
  const result = spawnSync(pgTool(tool), args, { env: pgEnv(), input, maxBuffer: 2 ** 30 });
  const ms = performance.now() - t0;
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${tool} exited ${result.status}: ${result.stderr.toString()}`);
  return { stdout: result.stdout, ms };
}

/** Row count and a digest of every row, per table, and every sequence position. */
async function contents(sql: Sql) {
  const tables = await sql<{ name: string }[]>`
    select format('%I', tablename) as name from pg_tables where schemaname = 'public' order by tablename`;
  const rows: Array<{ table: string; n: number; digest: string }> = [];
  for (const { name } of tables) {
    const [row] = await sql.unsafe<{ n: number; digest: string }[]>(
      `select count(*)::int as n, md5(coalesce(string_agg(t::text, E'\\n' order by t::text), '')) as digest
       from public.${name} t`,
    );
    rows.push({ table: name, ...row! });
  }
  const sequences = await sql`
    select sequencename, last_value::text from pg_sequences where schemaname = 'public' order by sequencename`;
  return { rows, sequences: sequences.map((s) => ({ ...s })) };
}

let source: TestDb;
let target: TestDb;
let demo: DemoResult;
let logBoardId: string;
let app: FastifyInstance | undefined;

beforeAll(async () => {
  source = await freshDb();
  target = await freshDb();
  demo = await ensureDemoData(source.admin);
  const boardOf = async (templateKey: string) => {
    const [row] = await source.admin`
      select b.id from boards b join incident_boards ib on ib.board_id = b.id
      where ib.incident_id = ${demo.incidentId} and b.template_key = ${templateKey} limit 1`;
    return row!.id as string;
  };
  logBoardId = await boardOf("activity_log");
  const roadBoardId = await boardOf("road_closures");
  await source.admin`
    insert into board_records (board_id, incident_id, data, created_by, created_at)
    select ${logBoardId}, ${demo.incidentId}, jsonb_build_object('entry', 'SYNTHETIC log line ' || g, 'notable', g % 25 = 0),
           ${demo.adminId}, now() - make_interval(secs => g * 7)
    from generate_series(1, ${LOG_LINES}) g`;
  await source.admin`
    insert into board_records (board_id, incident_id, data, geom, created_by, created_at)
    select ${roadBoardId}, ${demo.incidentId},
           jsonb_build_object('road', 'SYNTHETIC Route ' || g, 'reason', 'Exercise closure', 'status', 'closed'),
           ST_SetSRID(ST_MakePoint(-124.2 + g * 0.0004, 40.2 + g * 0.0003), 4326), ${demo.adminId},
           now() - make_interval(secs => g * 11)
    from generate_series(1, ${ROAD_CLOSURES}) g`;
  await source.admin`
    insert into files (jurisdiction_id, name, content_type, size, sha256, uploaded_by, attached_kind, attached_id)
    select ${demo.jurisdictionId}, 'SYNTHETIC situation map ' || g || '.pdf', 'application/pdf', 20000 + g,
           encode(sha256(convert_to('synthetic file ' || g, 'UTF8')), 'hex'), ${demo.adminId}, 'incident', ${demo.incidentId}
    from generate_series(1, ${FILES}) g`;
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  for (const db of [source, target]) {
    if (!db) continue;
    await db.runtime.end();
    await db.admin.end();
  }
});

describe("restore drill", () => {
  it("restores a dumped activation row for row in both deploy paths, needs no migration after it, and serves it", async () => {
    const dbName = async (sql: Sql) => (await sql<{ name: string }[]>`select current_database() as name`)[0]!.name;
    const sourceDb = await dbName(source.admin);
    const targetDb = await dbName(target.admin);
    const before = await contents(source.admin);
    const count = (table: string) => before.rows.find((row) => row.table === table)!.n;
    expect(count("board_records")).toBeGreaterThanOrEqual(LOG_LINES + ROAD_CLOSURES);
    expect(count("files")).toBeGreaterThanOrEqual(FILES);
    expect(count("audit_events")).toBeGreaterThan(0);
    expect(count("schema_migrations")).toBeGreaterThan(1);

    // Docker: backup.sh stores pg_dump's output gzipped; restore.sh pipes the
    // schema drop and the dump into one psql transaction.
    const dump = pg("pg_dump", ["--no-owner", "-d", sourceDb]);
    const gzipped = gzipSync(dump.stdout).length;
    const restore = pg("psql", ["-v", "ON_ERROR_STOP=1", "--single-transaction", "-q", "-d", targetDb],
      Buffer.concat([Buffer.from(`${DROP_SCHEMA}\n`), dump.stdout]));
    expect(await contents(target.admin)).toEqual(before);

    // Windows desktop: the launcher's pre-upgrade dump file, replayed with the
    // psql command the upgrade guide gives.
    const dir = mkdtempSync(join(tmpdir(), "openeoc-restore-drill-"));
    let desktopRestoreMs: number;
    try {
      const file = join(dir, "pre-upgrade.sql");
      pg("pg_dump", ["--no-owner", "-f", file, "-d", sourceDb]);
      desktopRestoreMs = pg("psql", ["-1", "-v", "ON_ERROR_STOP=1", "-q", "-c", DROP_SCHEMA, "-f", file, "-d", targetDb]).ms;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(await contents(target.admin)).toEqual(before);

    expect(await migrate(target.admin, MIGRATIONS)).toEqual([]);

    app = buildApp(target.runtime, { oidc: null });
    await app.ready();
    const token = await tokenFor(app, "demo-operator@example.org", "correct-horse-battery");
    const view = await app.inject({ method: "GET", url: `/api/v1/boards/${logBoardId}/views/all`, headers: auth(token) });
    expect(view.statusCode).toBe(200);
    expect(view.json().records).toHaveLength(100);

    const total = before.rows.reduce((sum, row) => sum + row.n, 0);
    const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    // eslint-disable-next-line no-console
    console.log(
      `[restore-drill] ${before.rows.length} tables, ${total} rows, ${count("board_records")} board records; ` +
        `pg_dump ${dump.ms.toFixed(0)} ms, ${mb(dump.stdout.length)} plain, ${mb(gzipped)} gzipped; ` +
        `restore ${restore.ms.toFixed(0)} ms from standard input, ${desktopRestoreMs.toFixed(0)} ms from a file`,
    );
  }, 180_000);
});
