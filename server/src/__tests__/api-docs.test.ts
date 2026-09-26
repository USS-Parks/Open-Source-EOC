import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { API_CONTRACT, generateApiDocs, generateOpenApi, OPENAPI_REQUEST_SCHEMA_ROUTES } from "@openeoc/shared";
import { buildApp } from "../app.js";
import type { Sql } from "../db/client.js";

/**
 * The published API docs are generated from the frozen contract, never
 * hand-edited (INV-4/INV-9). This test regenerates them and holds
 * the committed docs/API.md to the output, so the two cannot drift. To
 * refresh the file after a contract change, run vitest with UPDATE_DOCS=1.
 */

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "API.md");
const OPENAPI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "openapi.json");
const sql = (() => {
  throw new Error("route inventory must not query the database");
}) as unknown as Sql;

function inventoryApp(
  integrations: readonly ("collab" | "facilities" | "meetings" | "tracking")[],
) {
  return buildApp(sql, {
    integrations,
    oidc: {
      issuer: "https://identity.invalid",
      clientId: "route-inventory",
      clientSecret: "not-used",
      redirectUri: "https://eoc.invalid/api/v1/auth/oidc/callback",
    },
  });
}

function registeredRouteKeys(routeTable: string): string[] {
  const paths: string[] = [];
  const routes: string[] = [];
  for (const line of routeTable.split("\n")) {
    const match = line.match(/^((?:(?:│ {3}| {4}))*)(?:├──|└──) (.*?) \((.*?)\)$/);
    if (!match) continue;
    const [, prefix = "", segment, methodList] = match;
    if (segment === undefined || methodList === undefined) continue;
    const depth = prefix.length / 4;
    const fullPath = `${depth === 0 ? "" : paths[depth - 1]}${segment}`;
    paths[depth] = fullPath;
    for (const method of methodList.split(", ")) {
      if (method !== "HEAD") routes.push(`${method} ${fullPath}`);
    }
  }
  return routes.sort();
}

describe("generated API docs", () => {
  it("docs/API.md is current with the contract", () => {
    const generated = generateApiDocs();
    if (process.env.UPDATE_DOCS) writeFileSync(DOCS, generated);
    const onDisk = readFileSync(DOCS, "utf8");
    expect(onDisk).toBe(generated);
  });

  it("docs/openapi.json is current with the contract", () => {
    const generated = `${JSON.stringify(generateOpenApi(), null, 2)}
`;
    if (process.env.UPDATE_DOCS) writeFileSync(OPENAPI, generated);
    expect(readFileSync(OPENAPI, "utf8")).toBe(generated);
  });

  it("the OpenAPI document has every contract route and no other, and every reference resolves", () => {
    const doc = JSON.parse(readFileSync(OPENAPI, "utf8")) as {
      openapi: string;
      paths: Record<string, Record<string, { operationId: string; requestBody?: { $ref?: string } }>>;
    };
    expect(doc.openapi).toBe("3.1.0");
    const missing = API_CONTRACT.rest
      .filter((e) => !doc.paths[e.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")]?.[e.method.toLowerCase()])
      .map((e) => `${e.method} ${e.path}`);
    expect(missing).toEqual([]);
    const operations = Object.values(doc.paths).flatMap((ops) => Object.values(ops));
    expect(operations).toHaveLength(API_CONTRACT.rest.length);
    expect(new Set(operations.map((op) => op.operationId)).size).toBe(operations.length);
    // Every published request schema names a contract route, so a renamed route fails here.
    const keys = new Set(API_CONTRACT.rest.map((e) => `${e.method} ${e.path}`));
    expect(OPENAPI_REQUEST_SCHEMA_ROUTES.filter((key) => !keys.has(key))).toEqual([]);
    const text = JSON.stringify(doc);
    for (const [, ref] of text.matchAll(/"\$ref":"#\/([^"]+)"/g)) {
      const target = ref!.split("/").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], doc);
      expect(target, ref).toBeDefined();
    }
  });

  it("covers every registered Fastify method and path", async () => {
    const app = inventoryApp(["collab", "facilities", "meetings", "tracking"]);
    try {
      await app.ready();
      const registered = registeredRouteKeys(app.printRoutes({ commonPrefix: false }));
      const documented = API_CONTRACT.rest
        .map((endpoint) => `${endpoint.method} ${endpoint.path}`)
        .sort();
      expect(new Set(documented).size).toBe(documented.length);
      expect(documented).toEqual(registered);
    } finally {
      await app.close();
    }
  });

  it("keeps optional integration routes unregistered by default", async () => {
    const app = inventoryApp([]);
    try {
      await app.ready();
      const registered = registeredRouteKeys(app.printRoutes({ commonPrefix: false }));
      const defaultContract = API_CONTRACT.rest
        .filter((endpoint) => endpoint.integration === undefined)
        .map((endpoint) => `${endpoint.method} ${endpoint.path}`)
        .sort();
      expect(registered).toEqual(defaultContract);
    } finally {
      await app.close();
    }
  });
});
