import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { AuthError, principalFromToken, type Principal } from "../auth/service.js";
import type { BoardSyncHub } from "./hub.js";

const AuthMessage = z.object({ type: z.literal("auth"), token: z.string().min(1) });
const SyncQuery = z.object({ incidentId: z.string().uuid().optional() }).strict();
const UpdateMessage = z.union([
  z.object({
    type: z.literal("update"),
    update: z.string().min(1),
    operationId: z.string().uuid(),
    incidentId: z.string().uuid(),
  }).strict(),
  z.object({ type: z.literal("update"), update: z.string().min(1) }).strict(),
]);

/**
 * WebSocket sync endpoint. Protocol, all JSON text frames:
 *   client -> {type:"auth", token}          first frame, bearer token
 *   server -> {type:"state", update, seq?}  full board state as one update
 *   client -> {type:"update", update}       base64 Yjs update
 *   server -> {type:"synced", seq, conflicts}  ack for the sender
 *   server -> {type:"update", update}       peer updates, pushed
 *   server -> {type:"error", error}         then close, on any failure
 */
export function registerSyncRoutes(app: FastifyInstance, sql: Sql, hub: BoardSyncHub): void {
  void app.register(async (scoped) => {
    scoped.get("/api/v1/sync/boards/:boardId", { websocket: true }, (socket: WebSocket, req) => {
    const { boardId } = req.params as { boardId: string };
    const query = SyncQuery.safeParse(req.query);
    const incidentId = query.success ? query.data.incidentId ?? null : null;
    const sessionId = Math.random().toString(36).slice(2);
    let principal: Principal | null = null;
    let unsubscribe: (() => void) | null = null;

    const fail = (error: string, code: "auth_required" | "conflict" | "failed" = "failed") => {
      socket.send(JSON.stringify({ type: "error", error, code }));
      socket.close();
    };

    socket.on("message", (raw: Buffer) => {
      void (async () => {
        let message: unknown;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return fail("invalid frame");
        }
        try {
          if (!principal) {
            const auth = AuthMessage.safeParse(message);
            if (!auth.success) return fail("authenticate first");
            if (!query.success) return fail("invalid sync incident context");
            principal = await principalFromToken(sql, auth.data.token);
            const { state } = await hub.open(principal, boardId, incidentId);
            unsubscribe = hub.subscribe(boardId, incidentId, (update, origin) => {
              if (origin !== sessionId && socket.readyState === socket.OPEN) {
                socket.send(
                  JSON.stringify({
                    type: "update",
                    update: Buffer.from(update).toString("base64"),
                  }),
                );
              }
            });
            socket.send(
              JSON.stringify({ type: "state", update: Buffer.from(state).toString("base64") }),
            );
            return;
          }
          const parsed = UpdateMessage.safeParse(message);
          if (!parsed.success) return fail("unknown message type");
          if ("operationId" in parsed.data) {
            if (!incidentId || parsed.data.incidentId !== incidentId)
              throw new AuthError(409, "sync update does not match the joined incident");
          } else if (incidentId) {
            throw new AuthError(409, "incident-scoped sync requires an exact operation");
          }
          const result = await hub.apply(
            principal,
            boardId,
            new Uint8Array(Buffer.from(parsed.data.update, "base64")),
            sessionId,
            "operationId" in parsed.data
              ? { operationId: parsed.data.operationId, incidentId: parsed.data.incidentId }
              : null,
          );
          socket.send(
            JSON.stringify({ type: "synced", ...result }),
          );
        } catch (err) {
          const code = err instanceof AuthError && [401, 403, 404].includes(err.status)
            ? "auth_required"
            : err instanceof AuthError && err.status === 409
              ? "conflict"
              : "failed";
          return fail(err instanceof Error ? err.message : "sync failure", code);
        }
      })();
    });

    socket.on("close", () => {
      unsubscribe?.();
    });
    });
  });
}
