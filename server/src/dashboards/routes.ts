import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { principalFromToken, type Principal } from "../auth/service.js";
import { onBoardEvent } from "../events/bus.js";
import {
  boundBoardKeys,
  computeDashboard,
  createDashboard,
  exportDashboardTemplate,
  getDashboard,
  listDashboards,
  registerDashboardTemplate,
} from "./service.js";

const CreateDashboardBody = z.object({
  templateKey: z.string().min(1),
  version: z.number().int().positive().optional(),
  title: z.string().min(1).optional(),
});
const AuthMessage = z.object({ type: z.literal("auth"), token: z.string().min(1) });
const IncidentQuery = z.object({ incidentId: z.string().uuid().optional() }).strict();

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
      const q = z
        .object({
          field: z
            .string()
            .regex(/^[a-z][a-z0-9_]*$/)
            .optional(),
          equals: z.string().max(200).optional(),
          // Optional incident scope: totals count only this incident's tagged
          // records, so displayed counts reconcile with the incident's boards
          // (VEOC-79B2).
          incidentId: z.string().uuid().optional(),
        })
        .parse(req.query);
      const runtimeFilter =
        q.field !== undefined && q.equals !== undefined
          ? { field: q.field, equals: q.equals }
          : undefined;
      const snapshot = await withPerson(sql, req.principal.person.id, (tx) =>
        computeDashboard(tx, req.principal, dashboardId, runtimeFilter, q.incidentId),
      );
      return reply.send(snapshot);
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
        const incidentQuery = IncidentQuery.safeParse(req.query);
        if (!incidentQuery.success) {
          socket.send(JSON.stringify({ type: "error", error: "invalid incident scope" }));
          socket.close();
          return;
        }
        const incidentId = incidentQuery.data.incidentId;
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
            computeDashboard(tx, principal!, dashboardId, undefined, incidentId),
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
