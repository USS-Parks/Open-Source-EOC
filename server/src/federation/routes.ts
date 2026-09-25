import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import type { BoardSyncHub } from "../sync/hub.js";
import {
  createAgreement,
  federationStatus,
  pending,
  queueOutbound,
  receiveUpdates,
  registerPeer,
  setPeerLink,
} from "./service.js";

const PeerBody = z.object({ name: z.string().min(1) });
const AgreementBody = z.object({
  boardId: z.string().uuid(),
  canRead: z.boolean().optional(),
  canWrite: z.boolean().optional(),
  remoteBoardId: z.string().uuid().optional(),
});
const LinkBody = z.object({ endpointUrl: z.string().url(), token: z.string().min(1) });
const QueueBody = z.object({ boardId: z.string().uuid(), update: z.string().min(1) });
const ReceiveBody = z.object({
  boardId: z.string().uuid(),
  updates: z.array(z.string().min(1)),
  deletes: z.array(z.string().uuid()).max(10_000).default([]),
});

export function federationRoutes(
  app: FastifyInstance,
  sql: Sql,
  hub: BoardSyncHub,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/peers",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = PeerBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        registerPeer(tx, req.principal, jurisdictionId, body.name),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/federation",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const status = await withPerson(sql, req.principal.person.id, (tx) =>
        federationStatus(tx, req.principal, jurisdictionId),
      );
      return reply.send(status);
    },
  );

  app.post("/api/v1/peers/:peerId/agreements", { preHandler: authenticate }, async (req, reply) => {
    const { peerId } = req.params as { peerId: string };
    const body = AgreementBody.parse(req.body);
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      createAgreement(tx, req.principal, peerId, body.boardId, {
        ...(body.canRead !== undefined ? { canRead: body.canRead } : {}),
        ...(body.canWrite !== undefined ? { canWrite: body.canWrite } : {}),
        ...(body.remoteBoardId !== undefined ? { remoteBoardId: body.remoteBoardId } : {}),
      }),
    );
    return reply.status(201).send(result);
  });

  app.put("/api/v1/peers/:peerId/link", { preHandler: authenticate }, async (req, reply) => {
    const { peerId } = req.params as { peerId: string };
    const body = LinkBody.parse(req.body);
    await withPerson(sql, req.principal.person.id, (tx) =>
      setPeerLink(tx, req.principal, peerId, body.endpointUrl, body.token),
    );
    return reply.send({ ok: true });
  });

  app.post("/api/v1/peers/:peerId/queue", { preHandler: authenticate }, async (req, reply) => {
    const body = QueueBody.parse(req.body);
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      queueOutbound(tx, req.principal, body.boardId, body.update),
    );
    return reply.status(201).send(result);
  });

  app.get("/api/v1/peers/:peerId/pending", { preHandler: authenticate }, async (req, reply) => {
    const { peerId } = req.params as { peerId: string };
    const entries = await withPerson(sql, req.principal.person.id, (tx) =>
      pending(tx, req.principal, peerId),
    );
    return reply.send({ pending: entries });
  });

  // Peer-to-peer receive: authenticated by the peer token, not a user
  // session, so a remote instance can deliver its store-and-forward batch.
  app.post("/api/v1/federation/receive", async (req, reply) => {
    const token = String(req.headers["x-peer-token"] ?? "");
    if (!token) return reply.status(401).send({ error: "missing peer token" });
    const body = ReceiveBody.parse(req.body);
    const result = await receiveUpdates(sql, hub, token, body.boardId, body.updates, body.deletes);
    return reply.status(200).send(result);
  });
}
