import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { principalFromToken } from "../auth/service.js";

/** Announced by the notifications_announce trigger, migration 0111. */
const CHANNEL = "notifications_changed";
/** At most one signal per window; a change after a quiet spell goes out at once. */
const SIGNAL_WINDOW_MS = 1000;

const AuthMessage = z.object({ type: z.literal("auth"), token: z.string().min(1) });
const CHANGED = JSON.stringify({ type: "changed" });

/**
 * Notification push. Protocol, all JSON text frames:
 *   client -> {type:"auth", token}   first frame, bearer token
 *   server -> {type:"ready"}         subscribed; refetch once to cover the gap
 *   server -> {type:"changed"}       a notification this person may read was
 *                                    written or changed; refetch the inbox
 *   server -> {type:"error", error}  then close
 *
 * No notification content crosses this socket. The client refetches through
 * the REST inbox, which row-level security filters. A trigger announces each
 * changed row id on commit; the server holds one LISTEN connection, asks the
 * database who may read those rows, and signals only those people's sockets.
 */
export function notificationStreamRoutes(app: FastifyInstance, sql: Sql): void {
  const sockets = new Map<WebSocket, string>();
  const pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let lastFlush = 0;
  let listening: Promise<{ unlisten(): Promise<void> }> | null = null;

  /** Signal the given people's sockets, or every socket when null. */
  const signal = (people: ReadonlySet<string> | null) => {
    for (const [socket, personId] of sockets) {
      if ((!people || people.has(personId)) && socket.readyState === socket.OPEN) socket.send(CHANGED);
    }
  };

  const flush = async () => {
    timer = null;
    lastFlush = Date.now();
    const ids = [...pending];
    pending.clear();
    if (sockets.size === 0) return;
    try {
      const rows = await sql`select public.notification_audience(${ids}::uuid[]) as person_id`;
      signal(new Set(rows.map((row) => row.person_id as string)));
    } catch (err) {
      // Unsure who may read the rows: every client refetches under its own RLS.
      app.log.warn({ err }, "notification audience lookup failed");
      signal(null);
    }
  };

  // Started by the first subscriber. postgres.js re-listens after a dropped
  // connection and calls onlisten again; changes in that gap were missed, so
  // every client refetches.
  const listen = () =>
    (listening ??= sql
      .listen(
        CHANNEL,
        (id) => {
          pending.add(id);
          timer ??= setTimeout(() => void flush(), Math.max(0, lastFlush + SIGNAL_WINDOW_MS - Date.now()));
        },
        () => signal(null),
      )
      .catch((err: unknown) => {
        listening = null;
        throw err;
      }));

  app.addHook("onClose", async () => {
    if (timer) clearTimeout(timer);
    const current = listening;
    listening = null;
    await (await current?.catch(() => null))?.unlisten();
  });

  void app.register(async (scoped) => {
    scoped.get("/api/v1/notifications/stream", { websocket: true }, (socket: WebSocket) => {
      socket.once("message", (raw: Buffer) => {
        void (async () => {
          try {
            const auth = AuthMessage.safeParse(JSON.parse(raw.toString()));
            if (!auth.success) throw new Error("authenticate first");
            const principal = await principalFromToken(sql, auth.data.token);
            await listen();
            if (socket.readyState !== socket.OPEN) return;
            sockets.set(socket, principal.person.id);
            socket.send(JSON.stringify({ type: "ready" }));
          } catch (err) {
            const error = err instanceof SyntaxError ? "invalid frame" : err instanceof Error ? err.message : "stream failure";
            socket.send(JSON.stringify({ type: "error", error }));
            socket.close();
          }
        })();
      });
      socket.on("close", () => sockets.delete(socket));
    });
  });
}
