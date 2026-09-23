import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { API_CONTRACT } from "@openeoc/shared";

/**
 * Every operator route in the frozen contract is reachable from a screen.
 * Routes no screen should call are marked machine audience in the contract
 * with their reason; the rest must have a caller in the web sources, or sit
 * in the list below naming what still owes them a screen.
 */

const WEB_SRC = fileURLToPath(new URL("../../", import.meta.url));

/** Operator routes with no screen yet, each with the reason. Remove an entry when it gains a caller. */
const AWAITING_SCREEN: Readonly<Record<string, string>> = {
  "GET /api/v1/corrective-actions/:id": "no screen yet for an engine that exists",
  "GET /api/v1/dashboard-templates/:key/:version/export": "no screen yet for an engine that exists",
  "GET /api/v1/incidents/:incidentId/impact/compare": "no screen yet for an engine that exists",
  "GET /api/v1/jurisdictions/:jurisdictionId/lifelines": "no screen yet for an engine that exists",
  "GET /api/v1/jurisdictions/:jurisdictionId/notification-allowlist": "no screen yet for an engine that exists",
  "GET /api/v1/threads/:threadId/export": "no screen yet for an engine that exists",
  "POST /api/v1/checklist-items/:itemId/complete": "no screen yet for an engine that exists",
  "POST /api/v1/data-packs/datasets/:datasetId/load": "no screen yet for an engine that exists",
  "POST /api/v1/jurisdictions/:jurisdictionId/damage/baseline": "no screen yet for an engine that exists",
  "POST /api/v1/jurisdictions/:jurisdictionId/dashboards": "no screen yet for an engine that exists",
  "POST /api/v1/jurisdictions/:jurisdictionId/libraries": "no screen yet for an engine that exists",
  "POST /api/v1/jurisdictions/:jurisdictionId/notification-rules": "no screen yet for an engine that exists",
  "PUT /api/v1/jurisdictions/:jurisdictionId/lifelines": "no screen yet for an engine that exists",
  "PUT /api/v1/jurisdictions/:jurisdictionId/messaging-settings": "no screen yet for an engine that exists",
  "PUT /api/v1/jurisdictions/:jurisdictionId/notification-allowlist": "no screen yet for an engine that exists",
  "POST /api/v1/boards/:boardId/local-fields": "local board fields have no designer control yet",
  "GET /api/v1/incidents/:incidentId/briefings": "optional integration with no screen yet",
  "GET /api/v1/incidents/:incidentId/meetings": "optional integration with no screen yet",
  "GET /api/v1/jurisdictions/:jurisdictionId/collab": "optional integration with no screen yet",
  "GET /api/v1/jurisdictions/:jurisdictionId/meetings/config": "optional integration with no screen yet",
  "GET /api/v1/status-queries/:id": "optional integration with no screen yet",
  "GET /api/v1/tracked-objects/:id": "optional integration with no screen yet",
  "POST /api/v1/incidents/:incidentId/briefings": "optional integration with no screen yet",
  "POST /api/v1/incidents/:incidentId/collab/announce": "optional integration with no screen yet",
  "POST /api/v1/incidents/:incidentId/collab/archive": "optional integration with no screen yet",
  "POST /api/v1/incidents/:incidentId/collab/provision": "optional integration with no screen yet",
  "POST /api/v1/incidents/:incidentId/collab/sync": "optional integration with no screen yet",
  "POST /api/v1/incidents/:incidentId/meetings": "optional integration with no screen yet",
  "POST /api/v1/jurisdictions/:jurisdictionId/status-queries": "optional integration with no screen yet",
  "PUT /api/v1/jurisdictions/:jurisdictionId/collab/backend": "optional integration with no screen yet",
  "PUT /api/v1/jurisdictions/:jurisdictionId/meetings/config": "optional integration with no screen yet",
};

interface CallSite {
  readonly method: string;
  readonly segments: readonly string[];
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "__tests__") out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Each "/api/v1/" literal in the web sources, as path segments with every
 * interpolated segment marked "*". An interpolation that does not start a
 * segment is a query suffix and ends the path. The method is the last quoted
 * HTTP verb earlier in the same statement, else GET.
 */
function callSites(): CallSite[] {
  const sites: CallSite[] = [];
  for (const file of sourceFiles(WEB_SRC)) {
    const text = readFileSync(file, "utf8");
    for (let i = text.indexOf("/api/v1/"); i >= 0; i = text.indexOf("/api/v1/", i + 1)) {
      let path = "";
      let depth = 0;
      for (let j = i; j < text.length; j += 1) {
        const c = text[j]!;
        if (depth === 0 && (c === "`" || c === '"' || c === "'" || c === "?")) break;
        if (text.startsWith("${", j)) {
          if (depth === 0 && !path.endsWith("/")) break;
          depth += 1;
          j += 1;
          continue;
        }
        if (depth > 0) {
          if (c === "{") depth += 1;
          if (c === "}") {
            depth -= 1;
            if (depth === 0) path += "*";
          }
          continue;
        }
        path += c;
      }
      const statement = text.slice(Math.max(0, i - 300), i).split(";").pop() ?? "";
      const verbs = [...statement.matchAll(/"(GET|POST|PUT|PATCH|DELETE)"/g)];
      sites.push({ method: verbs.at(-1)?.[1] ?? "GET", segments: path.replace(/\/$/, "").split("/") });
    }
  }
  return sites;
}

function reaches(site: CallSite, method: string, path: string): boolean {
  const route = path.split("/");
  if (site.method !== method || site.segments.length !== route.length) return false;
  return route.every((part, k) => part.startsWith(":") || site.segments[k] === part);
}

describe("route coverage", () => {
  const sites = callSites();
  const operator = API_CONTRACT.rest.filter((e) => e.audience === "operator");

  it("finds the web client's call sites", () => {
    expect(sites.length).toBeGreaterThan(100);
  });

  it("reaches every operator route from a screen, or names what owes it one", () => {
    const unreached = operator
      .filter((e) => !sites.some((s) => reaches(s, e.method, e.path)))
      .map((e) => `${e.method} ${e.path}`);
    expect(unreached.filter((key) => !(key in AWAITING_SCREEN)), "operator routes with no caller").toEqual([]);
  });

  it("lists nothing as awaiting a screen once it has one", () => {
    const stale = Object.keys(AWAITING_SCREEN).filter((key) => {
      const [method, path] = key.split(" ");
      return sites.some((s) => reaches(s, method!, path!));
    });
    expect(stale).toEqual([]);
  });
});
