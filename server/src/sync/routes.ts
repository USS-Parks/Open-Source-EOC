import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { principalFromToken, type Principal } from "../auth/service.js";
import type { BoardSyncHub } from "./hub.js";

const AuthMessage = z.object({ type: z.literal("auth"), token: z.string().min(1) });
const UpdateMessage = z.object({ type: z.literal("update"), update: z.string().min(1) });

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
  void app.register(websocket);
  void app.register(async (scoped) => {
    scoped.get("/api/v1/sync/boards/:boardId", { websocket: true }, (socket: WebSocket, req) => {
    const { boardId } = req.params as { boardId: string };
    const sessionId = Math.random().toString(36).slice(2);
    let principal: Principal | null = null;
    let unsubscribe: (() => void) | null = null;

    const fail = (error: string) => {
      socket.send(JSON.stringify({ type: "error", error }));
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
            principal = await principalFromToken(sql, auth.data.token);
            const { state } = await hub.open(principal, boardId);
            unsubscribe = hub.subscribe(boardId, (update, origin) => {
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
          const result = await hub.apply(
            principal,
            boardId,
            new Uint8Array(Buffer.from(parsed.data.update, "base64")),
            sessionId,
          );
          socket.send(
            JSON.stringify({ type: "synced", seq: result.seq, conflicts: result.conflicts }),
          );
        } catch (err) {
          return fail(err instanceof Error ? err.message : "sync failure");
        }
      })();
    });

    socket.on("close", () => {
      unsubscribe?.();
    });
    });
  });
}
