import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { pageQuery } from "../db/cursor.js";
import { AuthError } from "../auth/service.js";
import { FEED_PAGE_LIMIT, createFeed, feedItems, ingestPush, listFeeds, pollFeed } from "./service.js";

export function feedRoutes(
  app: FastifyInstance,
  sql: Sql,
  authenticate: (req: FastifyRequest) => Promise<void>,
): void {
  // CoT events arrive as XML text; keep the raw body for the parser.
  app.addContentTypeParser(
    ["application/xml", "text/xml"],
    { parseAs: "string" },
    (_req, body, done) => done(null, body),
  );

  app.post(
    "/api/v1/jurisdictions/:jurisdictionId/feeds",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const result = await withPerson(sql, req.principal.person.id, (tx) =>
        createFeed(tx, req.principal, jurisdictionId, req.body),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/api/v1/jurisdictions/:jurisdictionId/feeds",
    { preHandler: authenticate },
    async (req, reply) => {
      const { jurisdictionId } = req.params as { jurisdictionId: string };
      const feeds = await withPerson(sql, req.principal.person.id, (tx) =>
        listFeeds(tx, req.principal, jurisdictionId),
      );
      return reply.send({ feeds });
    },
  );

  app.post("/api/v1/feeds/:feedId/poll", { preHandler: authenticate }, async (req, reply) => {
    const { feedId } = req.params as { feedId: string };
    // Fetches between its own transactions, never inside one.
    return reply.send(await pollFeed(sql, req.principal, feedId));
  });

  app.get("/api/v1/feeds/:feedId/items", { preHandler: authenticate }, async (req, reply) => {
    const { feedId } = req.params as { feedId: string };
    const page = z.object({
      cursor: pageQuery.cursor,
      limit: z.coerce.number().int().min(1).max(FEED_PAGE_LIMIT).optional(),
    }).parse(req.query);
    const result = await withPerson(sql, req.principal.person.id, (tx) =>
      feedItems(tx, req.principal, feedId, page),
    );
    return reply.header("content-type", "application/geo+json").send(result);
  });

  /** Push ingestion: feed-token auth, not a user session. */
  app.post("/api/v1/feeds/:feedId/ingest", async (req, reply) => {
    const { feedId } = req.params as { feedId: string };
    const token = String(req.headers["x-feed-token"] ?? "");
    if (!token) throw new AuthError(401, "missing feed token");
    const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
    const result = await ingestPush(sql, feedId, token, body);
    return reply.status(202).send(result);
  });
}
