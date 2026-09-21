import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import {
  DashboardCompositionSchema,
  DashboardFilterSetSchema,
  SavedStateKeySchema,
  type DashboardFilterSet,
  type WidgetFilter,
} from "@openeoc/shared";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { principalFromToken, type Principal } from "../auth/service.js";
import { onBoardEvent } from "../events/bus.js";
import { ViewportBboxParam } from "../impact/bbox.js";
import {
  boundBoardKeys,
  computeDashboard,
  createDashboard,
  exportDashboardTemplate,
  getDashboard,
  listDashboardContributions,
  listDashboards,
  registerDashboardTemplate,
} from "./service.js";
import {
  computeDashboardConfig,
  getDashboardConfig,
  listDashboardConfigs,
  putDashboardConfig,
  removeDashboardConfig,
} from "./config.js";

const CreateDashboardBody = z.object({
  templateKey: z.string().min(1),
  version: z.number().int().positive().optional(),
  title: z.string().min(1).optional(),
});
const AuthMessage = z.object({ type: z.literal("auth"), token: z.string().min(1) });
const IncidentQuery = z.object({ incidentId: z.string().uuid().optional() }).strict();
const DashboardStreamQuery = IncidentQuery.extend({ bbox: ViewportBboxParam.optional() }).strict();
const FilterQueryFields = {
  field: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
  equals: z.string().max(200).optional(),
  categoryField: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
  category: z.string().max(200).optional(),
  periodField: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
  periodRevision: z.coerce.number().int().positive().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
};
function validateFilterPairs(
  value: Record<string, unknown>,
  ctx: z.RefinementCtx,
): void {
  for (const [field, valueField] of [
    ["field", "equals"], ["categoryField", "category"],
    ["periodField", "periodRevision"],
  ] as const) {
    if ((value[field] === undefined) !== (value[valueField] === undefined))
      ctx.addIssue({ code: "custom", path: [field], message: `${field} and ${valueField} must be supplied together` });
  }
}
const DashboardDataQuery = z.object({
  ...FilterQueryFields,
  incidentId: z.string().uuid().optional(),
  bbox: ViewportBboxParam.optional(),
}).strict().superRefine(validateFilterPairs);
const DashboardContributionQuery = z.object({
  ...FilterQueryFields,
  incidentId: z.string().uuid(),
  bbox: ViewportBboxParam.optional(),
  group: z.string().max(200).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict().superRefine(validateFilterPairs);
const DashboardConfigDataQuery = z.object({
  ...FilterQueryFields,
  bbox: ViewportBboxParam.optional(),
  scope: z.enum(["saved", "incident"]).default("saved"),
  filterMode: z.enum(["inherit", "replace", "clear"]).default("inherit"),
}).strict().superRefine((value, ctx) => {
  validateFilterPairs(value, ctx);
  if (value.scope === "incident" && value.bbox !== undefined)
    ctx.addIssue({ code: "custom", path: ["bbox"], message: "incident scope cannot include bbox" });
  if (value.filterMode === "clear" && [
    "field", "equals", "categoryField", "category", "periodField", "periodRevision", "from", "to",
  ].some((key) => value[key as keyof typeof value] !== undefined))
    ctx.addIssue({ code: "custom", path: ["filterMode"], message: "clear filter mode cannot include filters" });
});
type DashboardDataQueryValue = z.infer<typeof DashboardDataQuery>;

function queryFilters(query: DashboardDataQueryValue): {
  runtimeFilter: WidgetFilter | undefined;
  filters: DashboardFilterSet | undefined;
} {
  const runtimeFilter = query.field === undefined
    ? undefined
    : { field: query.field, equals: query.equals! };
  const candidate = {
    ...(query.categoryField === undefined ? {} : {
      category: { field: query.categoryField, equals: query.category! },
    }),
    ...(query.periodField === undefined ? {} : {
      operationalPeriod: { field: query.periodField, areaRevision: query.periodRevision! },
    }),
    ...(query.from === undefined && query.to === undefined ? {} : {
      date: { ...(query.from ? { from: query.from } : {}), ...(query.to ? { to: query.to } : {}) },
    }),
  };
  const filters = Object.keys(candidate).length === 0
    ? undefined
    : DashboardFilterSetSchema.parse(candidate);
  return { runtimeFilter, filters };
}

const ConfigListQuery = z.object({
  cursor: SavedStateKeySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
const ConfigPutBody = z.object({
  expectedRevision: z.number().int().min(0),
  composition: DashboardCompositionSchema,
}).strict();
const ConfigDeleteQuery = z.object({ expectedRevision: z.coerce.number().int().min(1) }).strict();
const IncidentParams = z.object({ incidentId: z.string().uuid() });
const ConfigParams = IncidentParams.extend({ key: SavedStateKeySchema });
const ContributionParams = z.object({
  dashboardId: z.string().uuid(),
  widgetKey: z.string().regex(/^[a-z][a-z0-9_]*$/),
});

const RECOMPUTE_DEBOUNCE_MS = 50;

/**
 * Dashboard REST and live-stream routes. The stream protocol (JSON text
 * frames) mirrors the sync channel:
 *   client -> {type:"auth", token}      first frame
 *   server -> {type:"snapshot", data}   on connect and after each change
 *   server -> {type:"error", error}     then close, on any failure
 */
export function dashboardRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.post("/api/v1/dashboard-templates", { preHandler: authenticate }, async (req, reply) => {
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      registerDashboardTemplate(tx, req.principal, req.body),
    );
    return reply.status(201).send(result);
  });

  app.get(
    "/api/v1/dashboard-templates/:key/:version/export",
    { preHandler: authenticate },
    async (req, reply) => {
      const { key, version } = req.params as { key: string; version: string };
      const template = await withPerson(sql, req.principal.person.id, (tx) =>
        exportDashboardTemplate(tx, key, Number(version)),
      );
      return reply.send(template);
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/dashboards",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = CreateDashboardBody.parse(req.body);
      const id = await withPerson(sql, req.principal.person.id, (tx) =>
        createDashboard(tx, req.principal, jurisdictionId, body.templateKey, body.version, body.title),
      );
      return reply.status(201).send({ id });
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/dashboards",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const { incidentId } = IncidentQuery.parse(req.query);
      const dashboards = await withPerson(sql, req.principal.person.id, (tx) =>
        listDashboards(tx, req.principal, jurisdictionId, incidentId),
      );
      return reply.send({ dashboards });
    },
  );

  app.get("/api/v1/dashboards/:dashboardId", { preHandler: authenticate }, async (req, reply) => {
    const { dashboardId } = req.params as { dashboardId: string };
    const { incidentId } = IncidentQuery.parse(req.query);
    const dashboard = await withPerson(sql, req.principal.person.id, (tx) =>
      getDashboard(tx, req.principal, dashboardId, incidentId),
    );
    return reply.send(dashboard);
  });

  app.get(
    "/api/v1/dashboards/:dashboardId/data",
    { preHandler: authenticate },
    async (req, reply) => {
      const { dashboardId } = req.params as { dashboardId: string };
      // Optional runtime filter (?field=&equals=): scopes every counting
      // widget so drilldown and deep links reconcile to the same records.
      const q = DashboardDataQuery.parse(req.query);
      const { runtimeFilter, filters } = queryFilters(q);
      const snapshot = await withPerson(sql, req.principal.person.id, (tx) =>
        computeDashboard(
          tx, req.principal, dashboardId, runtimeFilter, q.incidentId, q.bbox, filters,
        ),
      );
      return reply.send(snapshot);
    },
  );

  app.get(
    "/api/v1/dashboards/:dashboardId/widgets/:widgetKey/records",
    { preHandler: authenticate },
    async (req, reply) => {
      const { dashboardId, widgetKey } = ContributionParams.parse(req.params);
      const q = DashboardContributionQuery.parse(req.query);
      const { runtimeFilter, filters } = queryFilters(q);
      const page = await withPerson(sql, req.principal.person.id, (tx) =>
        listDashboardContributions(
          tx, req.principal, dashboardId, widgetKey, q.incidentId,
          runtimeFilter, filters, q.group, q.cursor, q.limit, q.bbox,
        ),
      );
      return reply.send(page);
    },
  );

  app.get(
    "/api/v1/incidents/:incidentId/dashboard-configs",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId } = IncidentParams.parse(req.params);
      const q = ConfigListQuery.parse(req.query);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        listDashboardConfigs(tx, req.principal, incidentId, q.cursor, q.limit),
      );
      return reply.send(result);
    },
  );

  app.get(
    "/api/v1/incidents/:incidentId/dashboard-configs/:key",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId, key } = ConfigParams.parse(req.params);
      return reply.send(await withPerson(sql, req.principal.person.id, (tx) =>
        getDashboardConfig(tx, req.principal, incidentId, key),
      ));
    },
  );

  app.put(
    "/api/v1/incidents/:incidentId/dashboard-configs/:key",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId, key } = ConfigParams.parse(req.params);
      const body = ConfigPutBody.parse(req.body);
      const saved = await withPerson(sql, req.principal.person.id, (tx) =>
        putDashboardConfig(
          tx, req.principal, incidentId, key, body.expectedRevision, body.composition,
        ),
      );
      return reply.status(body.expectedRevision === 0 ? 201 : 200).send(saved);
    },
  );

  app.delete(
    "/api/v1/incidents/:incidentId/dashboard-configs/:key",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId, key } = ConfigParams.parse(req.params);
      const { expectedRevision } = ConfigDeleteQuery.parse(req.query);
      await withPerson(sql, req.principal.person.id, (tx) =>
        removeDashboardConfig(tx, req.principal, incidentId, key, expectedRevision),
      );
      return reply.status(204).send();
    },
  );

  app.get(
    "/api/v1/incidents/:incidentId/dashboard-configs/:key/data",
    { preHandler: authenticate },
    async (req, reply) => {
      const { incidentId, key } = ConfigParams.parse(req.params);
      const q = DashboardConfigDataQuery.parse(req.query);
      const { runtimeFilter, filters } = queryFilters(q);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        computeDashboardConfig(
          tx, req.principal, incidentId, key, runtimeFilter, filters,
          q.scope === "incident" ? null : q.bbox, q.filterMode,
        ),
      );
      return reply.send(result);
    },
  );

  void app.register(async (scoped) => {
    scoped.get(
      "/api/v1/dashboards/:dashboardId/stream",
      { websocket: true },
      (socket: WebSocket, req) => {
        const { dashboardId } = req.params as { dashboardId: string };
        // A live dashboard opened in an incident context stays scoped to it, so
        // pushed recomputes count the same incident's records as the REST read
        // (VEOC-79B2). An absent value stays unscoped; malformed scope fails closed.
        const incidentQuery = DashboardStreamQuery.safeParse(req.query);
        if (!incidentQuery.success) {
          socket.send(JSON.stringify({ type: "error", error: "invalid incident scope" }));
          socket.close();
          return;
        }
        const incidentId = incidentQuery.data.incidentId;
        const bbox = incidentQuery.data.bbox;
        let principal: Principal | null = null;
        let unsubscribe: (() => void) | null = null;
        let timer: NodeJS.Timeout | null = null;
        let closed = false;

        const fail = (error: string) => {
          socket.send(JSON.stringify({ type: "error", error }));
          socket.close();
        };

        const push = async () => {
          if (closed || !principal) return;
          const snapshot = await withPerson(sql, principal.person.id, (tx) =>
            computeDashboard(tx, principal!, dashboardId, undefined, incidentId, bbox),
          );
          if (!closed && socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: "snapshot", data: snapshot }));
          }
        };

        socket.on("message", (raw: Buffer) => {
          void (async () => {
            try {
              if (principal) return; // one auth frame is the whole protocol
              const auth = AuthMessage.safeParse(JSON.parse(raw.toString()));
              if (!auth.success) return fail("authenticate first");
              principal = await principalFromToken(sql, auth.data.token);
              const dashboard = await withPerson(sql, principal.person.id, (tx) =>
                getDashboard(tx, principal!, dashboardId, incidentId),
              );
              const bound = boundBoardKeys(dashboard.template);
              unsubscribe = onBoardEvent((event) => {
                if (event.jurisdictionId !== dashboard.jurisdictionId) return;
                if (!bound.has(event.boardKey)) return;
                // Debounced recompute: one push per burst of changes.
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => {
                  void push().catch(() => socket.close());
                }, RECOMPUTE_DEBOUNCE_MS);
              });
              await push();
            } catch (err) {
              return fail(err instanceof Error ? err.message : "stream failure");
            }
          })();
        });

        socket.on("close", () => {
          closed = true;
          if (timer) clearTimeout(timer);
          unsubscribe?.();
        });
      },
    );
  });
}
