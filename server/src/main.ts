import { dirname, join } from "node:path";
import { text } from "node:stream/consumers";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildApp } from "./app.js";
import { provisionJurisdiction } from "./auth/authz.js";
import { createPerson, type Principal } from "./auth/service.js";
import { connect, type Sql } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { ensureStandardTemplates } from "./boards/service.js";
import { ensureStandardIncidentTemplates } from "./incidents/service.js";
import { Scheduler } from "./scheduler/scheduler.js";
import { rotateSecretKey } from "./secrets/rotate.js";

/**
 * Production entrypoint. Two database identities, matching the
 * deployment doctrine and the test harness: the owner connection runs
 * migrations and seeds the standard templates (it may bypass RLS), and the
 * app runs on the app_runtime connection so Row-Level Security is always in
 * force. In an air-gapped install nothing here reaches the network: it talks
 * only to PostgreSQL and listens.
 *
 * Commands: `serve` (the default), `bootstrap` and `rotate-secret-key`.
 */

export interface StartResult {
  readonly close: () => Promise<void>;
  readonly url: string;
}

/** Command output for the operator. */
function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

function ownerUrl(): string {
  const url = process.env.OPENEOC_DATABASE_URL;
  if (!url) throw new Error("OPENEOC_DATABASE_URL (owner connection) is required");
  return url;
}

/** Owner connection with migrations applied and standard templates seeded. */
async function preparedOwner(url: string): Promise<Sql> {
  const owner = connect({ url });
  await migrate(owner, join(dirname(fileURLToPath(import.meta.url)), "..", "migrations"));
  await ensureStandardTemplates(owner);
  await ensureStandardIncidentTemplates(owner);
  return owner;
}

/**
 * Refuse to serve on a connection where Row-Level Security would not apply:
 * OPENEOC_RUNTIME_URL unset (the app would run as the owner), or a runtime
 * role that is a superuser, has BYPASSRLS, or owns a table whose policies do
 * not bind their owner. OPENEOC_ALLOW_OWNER_RUNTIME=1 overrides the refusal
 * and the returned warning is logged instead. Null means RLS applies.
 */
export async function checkRuntimeRole(
  sql: Sql,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  let problem: string | null = null;
  if (!env.OPENEOC_RUNTIME_URL) {
    problem = "OPENEOC_RUNTIME_URL is unset, so the app would run on the owner connection";
  } else {
    const [role] = await sql`
      select current_user as name,
             r.rolsuper or r.rolbypassrls or exists (
               select 1 from pg_class c
               where c.relrowsecurity and not c.relforcerowsecurity
                 and pg_has_role(current_user, c.relowner, 'USAGE')
             ) as bypasses
      from pg_roles r where r.rolname = current_user`;
    if (role?.bypasses)
      problem = `the runtime role ${String(role.name)} bypasses row-level security (superuser, BYPASSRLS or table owner)`;
  }
  if (!problem) return null;
  if (env.OPENEOC_ALLOW_OWNER_RUNTIME !== "1")
    throw new Error(
      `Refusing to serve: ${problem}. Set OPENEOC_RUNTIME_URL to the app_runtime role ` +
        "(see deploy/README.md), or OPENEOC_ALLOW_OWNER_RUNTIME=1 for a single-user development server.",
    );
  return `${problem}; serving anyway because OPENEOC_ALLOW_OWNER_RUNTIME=1. Row-Level Security does not apply.`;
}

export async function start(): Promise<StartResult> {
  const owner = ownerUrl();
  const runtimeUrl = process.env.OPENEOC_RUNTIME_URL || owner;
  await (await preparedOwner(owner)).end();

  const sql = connect({ url: runtimeUrl });
  let warning: string | null;
  try {
    warning = await checkRuntimeRole(sql);
  } catch (err) {
    await sql.end();
    throw err;
  }
  const app = buildApp(sql);
  if (warning) app.log.warn(warning);
  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST ?? "0.0.0.0";
  // Fastify logs the listening address.
  await app.listen({ port, host });
  const scheduler = new Scheduler(sql, { lockUrl: runtimeUrl, logger: app.log });
  app.metrics.delivery = scheduler.delivery;
  app.metrics.scheduler = scheduler;
  scheduler.start();
  const url = `http://${host}:${port}`;
  return {
    url,
    close: async () => {
      await scheduler.stop();
      await app.close();
      await sql.end();
    },
  };
}

export interface BootstrapInput {
  readonly email: string;
  readonly displayName: string;
  readonly jurisdictionSlug: string;
  readonly jurisdictionName: string;
  password: string;
}

/**
 * Validate the first-admin identity. `values` holds the flag values
 * admin-email, admin-name, jurisdiction-slug and jurisdiction-name; the
 * Windows desktop setup passes the same names.
 */
export function bootstrapInput(values: Record<string, unknown>, password: string): BootstrapInput {
  const input = {
    email: String(values["admin-email"] ?? "").trim().toLowerCase(),
    displayName: String(values["admin-name"] ?? "").trim(),
    jurisdictionSlug: String(values["jurisdiction-slug"] ?? "").trim(),
    jurisdictionName: String(values["jurisdiction-name"] ?? "").trim(),
    password,
  };
  if (!/^\S+@\S+\.\S+$/.test(input.email)) throw new Error("Production admin email is required");
  if (!input.displayName) throw new Error("Production admin display name is required");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.jurisdictionSlug))
    throw new Error("Jurisdiction slug must use lowercase letters, numbers, and single hyphens");
  if (!input.jurisdictionName) throw new Error("Jurisdiction name is required");
  if (input.password.length < 12) throw new Error("Production admin password must contain at least 12 characters");
  return input;
}

export type BootstrapResult =
  | { readonly created: false }
  | { readonly created: true; readonly personId: string; readonly jurisdictionId: string; readonly positions: number };

/**
 * Create the instance admin and the first jurisdiction, with that person as
 * its admin, in one transaction on the owner connection. Does nothing when
 * any instance admin already exists, so it is safe to run again.
 */
export async function bootstrapInstance(owner: Sql, input: BootstrapInput): Promise<BootstrapResult> {
  return (await owner.begin(async (tx) => {
    // Serializes two bootstraps racing on an empty database.
    await tx`select pg_advisory_xact_lock(hashtext('openeoc.bootstrap'))`;
    const [existing] = await tx`select 1 from persons where is_instance_admin limit 1`;
    if (existing) return { created: false };
    const sql = tx as unknown as Sql;
    const personId = await createPerson(sql, input);
    await tx`update persons set is_instance_admin = true where id = ${personId}`;
    const actor: Principal = {
      sessionId: "system",
      person: { id: personId, email: input.email, displayName: input.displayName },
      position: null,
      memberships: [],
      isInstanceAdmin: true,
      guests: [],
    };
    const provisioned = await provisionJurisdiction(sql, actor, {
      slug: input.jurisdictionSlug,
      name: input.jurisdictionName,
      adminPersonId: personId,
    });
    return { created: true, personId, ...provisioned };
  })) as BootstrapResult;
}

/**
 * `bootstrap --admin-email= --admin-name= --jurisdiction-slug= --jurisdiction-name=`
 * with the password from OPENEOC_BOOTSTRAP_PASSWORD or standard input. The
 * password is never printed.
 */
export async function bootstrapCommand(
  owner: Sql,
  args: readonly string[],
  password: string,
  log: (line: string) => void = print,
): Promise<BootstrapResult> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      "admin-email": { type: "string" },
      "admin-name": { type: "string" },
      "jurisdiction-slug": { type: "string" },
      "jurisdiction-name": { type: "string" },
    },
  });
  const input = bootstrapInput(values, password);
  const result = await bootstrapInstance(owner, input);
  input.password = "";
  log(
    result.created
      ? `Bootstrapped: instance admin ${input.email} administers jurisdiction ${input.jurisdictionSlug} (${result.jurisdictionId}).`
      : "An instance admin already exists; nothing was changed.",
  );
  return result;
}

async function run(command: string, args: readonly string[]): Promise<void> {
  if (command === "serve") {
    await start();
    return;
  }
  if (command === "bootstrap") {
    let password = process.env.OPENEOC_BOOTSTRAP_PASSWORD;
    delete process.env.OPENEOC_BOOTSTRAP_PASSWORD;
    password ??= (await text(process.stdin)).replace(/\r?\n$/, "");
    const owner = await preparedOwner(ownerUrl());
    try {
      await bootstrapCommand(owner, args, password);
    } finally {
      await owner.end();
    }
    return;
  }
  if (command === "rotate-secret-key") {
    const owner = connect({ url: ownerUrl() });
    try {
      const counts = await rotateSecretKey(
        owner,
        process.env.OPENEOC_SECRET_KEY ?? "",
        process.env.OPENEOC_NEW_SECRET_KEY ?? "",
      );
      for (const [table, count] of Object.entries(counts)) print(`${table}: ${count} re-encrypted`);
      print("Done. Set OPENEOC_SECRET_KEY to the new key before starting the server.");
    } finally {
      await owner.end();
    }
    return;
  }
  throw new Error(`Unknown command: ${command}. Use serve, bootstrap or rotate-secret-key.`);
}

// Run only when executed directly, never on import (tests import buildApp instead).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command = "serve", ...args] = process.argv.slice(2);
  run(command, args).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
