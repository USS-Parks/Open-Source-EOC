import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { Gazetteer } from "./gazetteer.js";

const SearchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(20).default(8),
  near: z.string().regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/).optional(),
});

/**
 * The gazetteer named by OPENEOC_GAZETTEER_PATH, or null. Search is an aid,
 * not a dependency: a missing or unreadable file is logged and the server
 * starts with address search reported unavailable.
 */
export function loadGazetteer(path: string | undefined, log: FastifyBaseLogger): Gazetteer | null {
  if (!path) return null;
  const started = Date.now();
  try {
    const gazetteer = Gazetteer.load(path);
    log.info({ path, entries: gazetteer.size, ms: Date.now() - started }, "offline address search loaded");
    return gazetteer;
  } catch (err) {
    log.warn({ err, path }, "offline address search unavailable: the gazetteer could not be read");
    return null;
  }
}

/** Offline forward search for any signed-in person; the data is the basemap's. */
export function geocodeRoutes(
  app: FastifyInstance,
  authenticate: (req: FastifyRequest) => Promise<void>,
  gazetteer: Gazetteer | null,
): void {
  app.get("/api/v1/geocode/search", { preHandler: authenticate }, async (req, reply) => {
    const query = SearchQuery.parse(req.query);
    if (!gazetteer) return reply.send({ available: false, results: [] });
    const near = query.near?.split(",").map(Number) as [number, number] | undefined;
    return reply.send({ available: true, results: gazetteer.search(query.q, { limit: query.limit, near }) });
  });
}
