import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import {
  createThread,
  exportThread,
  listMessages,
  listThreads,
  postMessage,
  setMessagingSettings,
} from "./service.js";

const CreateThreadBody = z.object({
  kind: z.enum(["direct", "group"]),
  title: z.string().max(200).optional(),
  incidentId: z.string().uuid().optional(),
  members: z
    .array(z.object({ kind: z.enum(["person", "position"]), id: z.string().uuid() }))
    .min(1),
});

const PostBody = z.object({
  body: z.string().min(1).max(8000),
  clientMessageId: z.string().max(64).optional(),
});

const SettingsBody = z.object({
  retentionDays: z.number().int().positive().nullable().optional(),
  inIncidentRecord: z.boolean().optional(),
});

export function messagingRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/threads",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = CreateThreadBody.parse(req.body);
      const id = await withPerson(sql, req.principal.person.id, (tx) =>
        createThread(tx, req.principal, { jurisdictionId, ...body }),
      );
      return reply.status(201).send({ id });
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/threads",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const threads = await withPerson(sql, req.principal.person.id, (tx) =>
        listThreads(tx, req.principal, jurisdictionId),
      );
      return reply.send({ threads });
    },
  );

  app.post(
    "/api/v1/threads/:threadId/messages",
    { preHandler: authenticate },
    async (req, reply) => {
      const { threadId } = req.params as { threadId: string };
      const body = PostBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        postMessage(tx, req.principal, threadId, body.body, body.clientMessageId),
      );
      return reply.status(result.deduplicated ? 200 : 201).send(result);
    },
  );

  app.get(
    "/api/v1/threads/:threadId/messages",
    { preHandler: authenticate },
    async (req, reply) => {
      const { threadId } = req.params as { threadId: string };
      const after = Number((req.query as { after?: string }).after ?? 0);
      const messages = await withPerson(sql, req.principal.person.id, (tx) =>
        listMessages(tx, req.principal, threadId, after),
      );
      return reply.send({ messages });
    },
  );

  app.get(
    "/api/v1/threads/:threadId/export",
    { preHandler: authenticate },
    async (req, reply) => {
      const { threadId } = req.params as { threadId: string };
      const lines = await withPerson(sql, req.principal.person.id, (tx) =>
        exportThread(tx, req.principal, threadId),
      );
      return reply.send({ lines });
    },
  );

  app.put(
    "/api/v1/jurisdictions/:jurisdictionId/messaging-settings",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = SettingsBody.parse(req.body);
      await withPerson(sql, req.principal.person.id, (tx) =>
        setMessagingSettings(tx, req.principal, jurisdictionId, body),
      );
      return reply.send({ ok: true });
    },
  );
}
