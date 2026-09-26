import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { AuthError, principalFromToken, type Principal } from "../auth/service.js";
import { RestrictedBoardError, type BoardSyncHub } from "./hub.js";
import { MAX_PAYLOAD_BYTES } from "./sockets.js";

/** Longest base64 update accepted: it and the largest envelope fit in one frame. */
export const MAX_UPDATE_CHARS = MAX_PAYLOAD_BYTES - 1024;

const AuthMessage = z.object({ type: z.literal("auth"), token: z.string().min(1) });
const SyncQuery = z.object({ incidentId: z.string().uuid().optional() }).strict();
const Update = z.string().min(1).max(MAX_UPDATE_CHARS);
const UpdateMessage = z.union([
  z.object({
    type: z.literal("update"),
    update: Update,
    operationId: z.string().uuid(),
    incidentId: z.string().uuid(),
    queuedAt: z.string().datetime({ offset: true }).optional(),
  }).strict(),
  z.object({ type: z.literal("update"), update: Update }).strict(),
]);

/** A live board socket whose reader holds a guest grant for the board. */
interface GuestSocket {
  readonly sql: Sql;
  readonly personId: string;
  readonly boardId: string;
  readonly end: () => void;
}

const guestSockets = new Set<GuestSocket>();

/**
 * Close every live board socket whose guest reader the row-level security
 * wall no longer admits to its board, as after a revoked grant or a locked
 * incident. Access is checked once at join, so a route that narrows guest
 * access calls this after its transaction commits. A check that cannot run
 * closes the socket.
 */
export async function closeWithdrawnGuestSockets(): Promise<void> {
  for (const socket of [...guestSockets]) {
    const admitted = await withPerson(socket.sql, socket.personId, (tx) =>
      tx`select 1 from boards where id = ${socket.boardId}`).then((rows) => rows.length > 0, () => false);
    if (!admitted) socket.end();
  }
}

/**
 * WebSocket sync endpoint. Protocol, all JSON text frames:
 *   client -> {type:"auth", token}          first frame, bearer token
 *   server -> {type:"state", update, seq?}  full board state as one update
 *   client -> {type:"update", update}       base64 Yjs update
 *   server -> {type:"synced", seq, conflicts, late?}  ack for the sender; `late`
 *             names the late submission that holds it when the incident had closed
 *   server -> {type:"update", update}       peer updates, pushed
 *   server -> {type:"error", error}         then close, on any failure
 */
export function registerSyncRoutes(app: FastifyInstance, sql: Sql, hub: BoardSyncHub): void {
  // The hub hands every subscriber the same update in one synchronous pass,
  // so the frame is encoded once per update rather than once per socket.
  let lastUpdate: Uint8Array | null = null;
  let lastFrame = Buffer.alloc(0);
  const updateFrame = (update: Uint8Array): Buffer => {
    if (update !== lastUpdate) {
      lastUpdate = update;
      lastFrame = Buffer.from(JSON.stringify({ type: "update", update: Buffer.from(update).toString("base64") }));
    }
    return lastFrame;
  };

  void app.register(async (scoped) => {
    scoped.get("/api/v1/sync/boards/:boardId", { websocket: true }, (socket: WebSocket, req) => {
    const { boardId } = req.params as { boardId: string };
    const query = SyncQuery.safeParse(req.query);
    if (!query.success) {
      socket.send(JSON.stringify({
        type: "error", error: "invalid sync incident context", code: "failed",
      }));
      socket.close();
      return;
    }
    const incidentId = query.data.incidentId ?? null;
    const sessionId = randomUUID();
    let principal: Principal | null = null;
    let unsubscribe: (() => void) | null = null;

    const fail = (error: string, code: "auth_required" | "restricted" | "conflict" | "failed" = "failed") => {
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
            principal = await principalFromToken(sql, auth.data.token);
            const { state, live } = await hub.open(principal, boardId, incidentId);
            // A caller a record rule restricts sends its own records and hears
            // no one else's.
            const release = live
              ? hub.subscribe(boardId, incidentId, (update, origin) => {
                if (origin !== sessionId && socket.readyState === socket.OPEN) {
                  socket.send(updateFrame(update), { binary: false });
                }
              })
              : () => undefined;
            const personId = principal.person.id;
            const guest = principal.guests.some((g) => g.scopes.includes(`board:${boardId}:read`))
              ? { sql, personId, boardId, end: () => fail("access to this board has ended", "auth_required") }
              : null;
            if (guest) guestSockets.add(guest);
            unsubscribe = () => {
              if (guest) guestSockets.delete(guest);
              release();
            };
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
              ? { operationId: parsed.data.operationId, incidentId: parsed.data.incidentId,
                  queuedAt: parsed.data.queuedAt ?? null }
              : null,
          );
          socket.send(
            JSON.stringify({ type: "synced", ...result }),
          );
        } catch (err) {
          const code = err instanceof RestrictedBoardError
            ? "restricted"
            : err instanceof AuthError && [401, 403, 404].includes(err.status)
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
