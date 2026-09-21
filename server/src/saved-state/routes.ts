import {
  MAX_SAVED_STATE_LIST,
  SavedStateKeySchema,
  SavedStateKindSchema,
  SavedStateWriteSchema,
} from "@openeoc/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import {
  deleteSavedState,
  getSavedState,
  listSavedStates,
  saveSavedState,
} from "./service.js";

const IncidentParams = z.object({ incidentId: z.string().uuid() }).strict();
const StateParams = IncidentParams.extend({
  kind: SavedStateKindSchema,
  key: SavedStateKeySchema,
}).strict();
const ListQuery = z.object({
  kind: SavedStateKindSchema,
  cursor: SavedStateKeySchema.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_SAVED_STATE_LIST).optional(),
}).strict();
const DeleteQuery = z.object({
  expectedRevision: z.coerce.number().int().min(1).max(2_147_483_647),
}).strict();

export function savedStateRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.get(
    "/api/v1/incidents/:incidentId/saved-state",
    { preHandler: authenticate },
    async (req) => {
      const { incidentId } = IncidentParams.parse(req.params);
      const query = ListQuery.parse(req.query);
      return withPerson(sql, req.principal.person.id, (tx) =>
        listSavedStates(tx, req.principal, incidentId, query.kind, query.cursor, query.limit ?? 50),
      );
    },
  );

  app.get(
    "/api/v1/incidents/:incidentId/saved-state/:kind/:key",
    { preHandler: authenticate },
    async (req) => {
      const { incidentId, kind, key } = StateParams.parse(req.params);
      const state = await withPerson(sql, req.principal.person.id, (tx) =>
        getSavedState(tx, req.principal, incidentId, kind, key),
      );
      return { state };
    },
  );

  app.put(
    "/api/v1/incidents/:incidentId/saved-state/:kind/:key",
    { preHandler: authenticate },
    async (req) => {
      const { incidentId, kind, key } = StateParams.parse(req.params);
      const input = SavedStateWriteSchema.parse(req.body);
      const state = await withPerson(sql, req.principal.person.id, (tx) =>
        saveSavedState(tx, req.principal, incidentId, kind, key, input),
      );
      return { state };
    },
  );

  app.delete(
    "/api/v1/incidents/:incidentId/saved-state/:kind/:key",
    { preHandler: authenticate },
    async (req) => {
      const { incidentId, kind, key } = StateParams.parse(req.params);
      const { expectedRevision } = DeleteQuery.parse(req.query);
      await withPerson(sql, req.principal.person.id, (tx) =>
        deleteSavedState(tx, req.principal, incidentId, kind, key, expectedRevision),
      );
      return { ok: true };
    },
  );
}
