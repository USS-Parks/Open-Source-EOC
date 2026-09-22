import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { API_CONTRACT, generateApiDocs } from "@openeoc/shared";
import { buildApp } from "../app.js";
import type { Sql } from "../db/client.js";

/**
 * The published API docs are generated from the frozen contract, never
 * hand-edited (INV-4/INV-9). This test regenerates them and holds
 * the committed docs/API.md to the output, so the two cannot drift. To
 * refresh the file after a contract change, run vitest with UPDATE_DOCS=1.
 */

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "API.md");

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

  it("covers every registered Fastify method and path", async () => {
    const sql = (() => {
      throw new Error("route inventory must not query the database");
    }) as unknown as Sql;
    const app = buildApp(sql, {
      oidc: {
        issuer: "https://identity.invalid",
        clientId: "route-inventory",
        clientSecret: "not-used",
        redirectUri: "https://eoc.invalid/api/v1/auth/oidc/callback",
      },
    });
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
});
