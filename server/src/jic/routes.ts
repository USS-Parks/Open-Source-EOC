import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { pageQuery } from "../db/cursor.js";
import {
  answerInquiry,
  assignInquiry,
  decideLocal,
  draftRelease,
  listInquiries,
  listPublicFeed,
  listReleases,
  logInquiry,
  publishRelease,
  receivePeerDecision,
  submitRelease,
} from "./service.js";

/**
 * Joint Information Center routes (VEOC-33A, R4). Drafting, approval,
 * publication, and media-inquiry handling run under the caller's person
 * context so PIO attribution and RLS hold. The peer-decision route is
 * authenticated by a federation peer token, not a user session.
 */

const DraftBody = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  requiredAgencies: z.array(z.string().min(1)).default([]),
  incidentId: z.string().uuid().optional(),
});
const DecisionBody = z.object({
  agency: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
  note: z.string().optional(),
});
const PublishBody = z.object({
  toPublicFeed: z.boolean().optional(),
  toCollab: z.boolean().optional(),
  capDraft: z.record(z.string(), z.unknown()).optional(),
});
const ReceiveBody = z.object({
  releaseId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  note: z.string().optional(),
});
const InquiryBody = z.object({
  outlet: z.string().min(1),
  subject: z.string().min(1),
  question: z.string().min(1),
  incidentId: z.string().uuid().optional(),
});
const AssignBody = z.object({ positionId: z.string().uuid() });
const AnswerBody = z.object({ responseReleaseId: z.string().uuid() });
/** List query: optional incident, a comma-separated status set, and the page. */
const listQuery = <T extends readonly [string, ...string[]]>(statuses: T) => z.object({
  incidentId: z.string().uuid().optional(),
  status: z.string().transform((value) => value.split(",")).pipe(z.array(z.enum(statuses))).optional(),
  ...pageQuery,
});
const ReleaseListQuery = listQuery(["draft", "pending", "approved", "published", "rejected"]);
const InquiryListQuery = listQuery(["open", "assigned", "answered"]);

export function jicRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/jic/releases",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = DraftBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        draftRelease(tx, req.principal, jurisdictionId, {
          title: body.title,
          body: body.body,
          requiredAgencies: body.requiredAgencies,
          ...(body.incidentId !== undefined ? { incidentId: body.incidentId } : {}),
        }),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/jic/releases",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const { incidentId, status, ...page } = ReleaseListQuery.parse(req.query);
      const { items, nextCursor } = await withPerson(sql, req.principal.person.id, (tx) =>
        listReleases(tx, req.principal, jurisdictionId, { statuses: status, incidentId }, page),
      );
      return reply.send({ releases: items, nextCursor });
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/jic/inquiries",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const { incidentId, status, ...page } = InquiryListQuery.parse(req.query);
      const { items, nextCursor } = await withPerson(sql, req.principal.person.id, (tx) =>
        listInquiries(tx, req.principal, jurisdictionId, { statuses: status, incidentId }, page),
      );
      return reply.send({ inquiries: items, nextCursor });
    },
  );

  app.post("/api/v1/jic/releases/:releaseId/submit", { preHandler: authenticate }, async (req, reply) => {
    const { releaseId } = req.params as { releaseId: string };
    await withPerson(sql, req.principal.person.id, (tx) => submitRelease(tx, req.principal, releaseId));
    return reply.send({ ok: true });
  });

  app.post(
    "/api/v1/jic/releases/:releaseId/decisions",
    { preHandler: authenticate },
    async (req, reply) => {
      const { releaseId } = req.params as { releaseId: string };
      const body = DecisionBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        decideLocal(tx, req.principal, releaseId, body.agency, body.decision, body.note),
      );
      return reply.send(result);
    },
  );

  app.post(
    "/api/v1/jic/releases/:releaseId/publish",
    { preHandler: authenticate },
    async (req, reply) => {
      const { releaseId } = req.params as { releaseId: string };
      const body = PublishBody.parse(req.body ?? {});
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        publishRelease(tx, req.principal, releaseId, {
          ...(body.toPublicFeed !== undefined ? { toPublicFeed: body.toPublicFeed } : {}),
          ...(body.toCollab !== undefined ? { toCollab: body.toCollab } : {}),
          ...(body.capDraft !== undefined ? { capDraft: body.capDraft } : {}),
        }),
      );
      return reply.send(result);
    },
  );

  // Peer-to-peer: a federation peer records its agency's decision.
  app.post("/api/v1/jic/approvals/receive", async (req, reply) => {
    const token = String(req.headers["x-peer-token"] ?? "");
    if (!token) return reply.status(401).send({ error: "missing peer token" });
    const body = ReceiveBody.parse(req.body);
    const result = await receivePeerDecision(sql, token, body.releaseId, body.decision, body.note);
    return reply.send(result);
  });

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/jic/public",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const feed = await withPerson(sql, req.principal.person.id, (tx) =>
        listPublicFeed(tx, req.principal, jurisdictionId),
      );
      return reply.send({ public: feed });
    },
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/jic/inquiries",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const body = InquiryBody.parse(req.body);
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        logInquiry(tx, req.principal, jurisdictionId, {
          outlet: body.outlet,
          subject: body.subject,
          question: body.question,
          ...(body.incidentId !== undefined ? { incidentId: body.incidentId } : {}),
        }),
      );
      return reply.status(201).send(result);
    },
  );

  app.post("/api/v1/jic/inquiries/:inquiryId/assign", { preHandler: authenticate }, async (req, reply) => {
    const { inquiryId } = req.params as { inquiryId: string };
    const body = AssignBody.parse(req.body);
    await withPerson(sql, req.principal.person.id, (tx) =>
      assignInquiry(tx, req.principal, inquiryId, body.positionId),
    );
    return reply.send({ ok: true });
  });

  app.post("/api/v1/jic/inquiries/:inquiryId/answer", { preHandler: authenticate }, async (req, reply) => {
    const { inquiryId } = req.params as { inquiryId: string };
    const body = AnswerBody.parse(req.body);
    await withPerson(sql, req.principal.person.id, (tx) =>
      answerInquiry(tx, req.principal, inquiryId, body.responseReleaseId),
    );
    return reply.send({ ok: true });
  });
}
