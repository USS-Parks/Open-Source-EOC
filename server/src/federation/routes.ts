import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import type { BoardSyncHub } from "../sync/hub.js";
import { AuthError } from "../auth/service.js";
import {
  BATCH_FILE_FORMAT,
  FEDERATION_BODY_LIMIT,
  FEDERATION_FILE_LIMIT,
  RECEIPT_FORMAT,
  createAgreement,
  exportBatchFile,
  federationStatus,
  importBatchFile,
  importReceipt,
  isPeerToken,
  pending,
  queueOutbound,
  receiveUpdates,
  registerPeer,
  revokeAgreement,
  setPeerKey,
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
const KeyBody = z.object({ publicKey: z.string().min(1).max(4096) });
const QueueBody = z.object({ boardId: z.string().uuid(), update: z.string().min(1) });
const ReceiveBody = z.object({
  boardId: z.string().uuid(),
  updates: z.array(z.string().min(1)),
  deletes: z.array(z.string().uuid()).max(10_000).default([]),
  signature: z.string().max(200).optional(),
});
const BatchFileBody = z.object({
  format: z.literal(BATCH_FILE_FORMAT),
  version: z.literal(1),
  batches: z.array(ReceiveBody).min(1).max(10_000),
});
const ReceiptBody = z.object({
  format: z.literal(RECEIPT_FORMAT),
  version: z.literal(1),
  batches: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(1).max(10_000),
  signature: z.string().min(1).max(200),
});

/** Read a carried file, saying plainly when it is not the kind asked for. */
function parseFile<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AuthError(400, `the file is not ${what} from Open Source EOC`);
  return parsed.data;
}

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

  app.put("/api/v1/peers/:peerId/key", { preHandler: authenticate }, async (req, reply) => {
    const { peerId } = req.params as { peerId: string };
    const body = KeyBody.parse(req.body);
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      setPeerKey(tx, req.principal, peerId, body.publicKey),
    );
    return reply.send(result);
  });

  app.delete("/api/v1/peers/:peerId/agreements/:agreementId", { preHandler: authenticate }, async (req, reply) => {
    const { peerId, agreementId } = req.params as { peerId: string; agreementId: string };
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      revokeAgreement(tx, req.principal, peerId, agreementId),
    );
    return reply.send(result);
  });

  // Exchange by file (AG-04): the waiting batch out as a file, a partner's
  // file in through the receive lane, and the partner's receipt back.
  app.post("/api/v1/peers/:peerId/exchange/export", { preHandler: authenticate }, async (req, reply) => {
    const { peerId } = req.params as { peerId: string };
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      exportBatchFile(tx, req.principal, peerId),
    );
    return reply.send(result);
  });

  // Signed in before the body is read, so only a session can send a body up to the file limit.
  app.post(
    "/api/v1/peers/:peerId/exchange/import",
    { onRequest: authenticate, bodyLimit: FEDERATION_FILE_LIMIT },
    async (req, reply) => {
      const { peerId } = req.params as { peerId: string };
      const file = parseFile(BatchFileBody, req.body, "a federation batch file");
      // Not in one transaction: each update applies through the sync hub, as a push does.
      const result = await importBatchFile(sql, hub, req.principal, peerId, file.batches);
      return reply.send(result);
    },
  );

  app.post("/api/v1/peers/:peerId/exchange/receipt", { preHandler: authenticate }, async (req, reply) => {
    const { peerId } = req.params as { peerId: string };
    const receipt = parseFile(ReceiptBody, req.body, "a federation receipt");
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      importReceipt(tx, req.principal, peerId, receipt),
    );
    return reply.send(result);
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

  // Peer-to-peer receive: admitted by the peer token, not a user session, so
  // a remote instance can deliver its store-and-forward batch, and applied
  // only when the batch's signature verifies under the peer's recorded key.
  // The token is checked before the body is read, so only a known peer can
  // send a body up to the federation limit.
  app.post(
    "/api/v1/federation/receive",
    {
      bodyLimit: FEDERATION_BODY_LIMIT,
      onRequest: async (req, reply) => {
        const token = String(req.headers["x-peer-token"] ?? "");
        if (!token) return reply.status(401).send({ error: "missing peer token" });
        if (!(await isPeerToken(sql, token))) return reply.status(401).send({ error: "unknown peer" });
      },
    },
    async (req, reply) => {
      const token = String(req.headers["x-peer-token"] ?? "");
      const body = ReceiveBody.parse(req.body);
      const result = await receiveUpdates(sql, hub, token, body.boardId, body.updates, body.deletes, body.signature);
      return reply.status(200).send(result);
    },
  );
}
