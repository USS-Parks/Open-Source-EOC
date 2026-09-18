import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildApp } from "./app.js";
import { connect } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { ensureStandardTemplates } from "./boards/service.js";
import { ensureStandardIncidentTemplates } from "./incidents/service.js";

/**
 * Production entrypoint (VEOC-40). Two database identities, matching the
 * deployment doctrine and the test harness: the owner connection runs
 * migrations and seeds the standard templates (it may bypass RLS), and the
 * app runs on the app_runtime connection so Row-Level Security is always in
 * force. In an air-gapped install nothing here reaches the network: it talks
 * only to PostgreSQL and listens.
 */

export interface StartResult {
  readonly close: () => Promise<void>;
  readonly url: string;
}

export async function start(): Promise<StartResult> {
  const ownerUrl = process.env.OPENEOC_DATABASE_URL;
  if (!ownerUrl) throw new Error("OPENEOC_DATABASE_URL (owner connection) is required");
  const runtimeUrl = process.env.OPENEOC_RUNTIME_URL ?? ownerUrl;

  const owner = connect({ url: ownerUrl });
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  await migrate(owner, migrationsDir);
  await ensureStandardTemplates(owner);
  await ensureStandardIncidentTemplates(owner);
  await owner.end();

  if (runtimeUrl === ownerUrl) {
    // Dev/single-user convenience only; production sets a distinct
    // app_runtime URL so RLS is the second wall it is meant to be.
    // eslint-disable-next-line no-console
    console.warn(
      "[openeoc] OPENEOC_RUNTIME_URL is unset; running the app on the owner connection. " +
        "Set a distinct app_runtime URL in production so Row-Level Security applies.",
    );
  }

  const sql = connect({ url: runtimeUrl });
  const app = buildApp(sql);
  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST ?? "0.0.0.0";
  await app.listen({ port, host });
  const url = `http://${host}:${port}`;
  // eslint-disable-next-line no-console
  console.log(`[openeoc] listening on ${url}`);
  return {
    url,
    close: async () => {
      await app.close();
      await sql.end();
    },
  };
}

// Boot only when run directly, never on import (tests import buildApp instead).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
