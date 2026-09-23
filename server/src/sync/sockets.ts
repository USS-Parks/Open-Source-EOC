import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";

/** Largest frame a client may send. Past it ws closes the socket with 1009. */
export const MAX_PAYLOAD_BYTES = 1024 * 1024;

export interface SocketLimits {
  /** A client must send its first frame, the auth frame, within this long. */
  readonly authDeadlineMs: number;
  /** Ping interval. A peer that has not answered the previous ping is dropped. */
  readonly heartbeatMs: number;
  /**
   * Bytes queued to one peer past which it is disconnected rather than sent
   * more. Set well above a large board's state frame, sent once on connect,
   * so a large board opened over a slow link is not dropped while it drains.
   */
  readonly maxBufferedBytes: number;
}

export const DEFAULT_SOCKET_LIMITS: SocketLimits = {
  authDeadlineMs: 10_000,
  heartbeatMs: 30_000,
  maxBufferedBytes: 16 * 1024 * 1024,
};

/**
 * Discipline for every WebSocket the server accepts, whatever its route.
 *
 * - Auth deadline: each protocol opens with an auth frame and closes on
 *   anything else, so a socket silent past the deadline is closed with 1008.
 * - Heartbeat: a ping each interval; no pong by the next one and the peer is
 *   terminated. A peer that has stopped reading never sees the ping either.
 * - Backpressure: a send while the peer's queue is past the ceiling closes it
 *   with 1013 instead. A dropped sync client resyncs from state on reconnect,
 *   so shedding it loses nothing, and a stalled reader cannot hold the
 *   others' memory or time.
 */
export function disciplineSockets(app: FastifyInstance, limits: SocketLimits): void {
  const alive = new WeakSet<WebSocket>();
  let heartbeat: NodeJS.Timeout | null = null;

  app.addHook("onReady", async () => {
    const server = app.websocketServer;
    server.on("connection", (socket: WebSocket) => {
      alive.add(socket);
      socket.on("pong", () => alive.add(socket));
      const deadline = setTimeout(() => socket.close(1008, "authentication timeout"), limits.authDeadlineMs);
      socket.once("message", () => clearTimeout(deadline));
      socket.once("close", () => clearTimeout(deadline));

      // Wraps this socket's send so every route, present and future, is
      // covered without each one remembering to check the queue.
      const send = socket.send.bind(socket) as (...args: unknown[]) => void;
      socket.send = ((...args: unknown[]) => {
        if (socket.bufferedAmount <= limits.maxBufferedBytes) return send(...args);
        if (socket.readyState === socket.OPEN) socket.close(1013, "slow consumer");
      }) as WebSocket["send"];
    });
    heartbeat = setInterval(() => {
      for (const socket of server.clients) {
        if (!alive.has(socket)) {
          socket.terminate();
          continue;
        }
        alive.delete(socket);
        socket.ping();
      }
    }, limits.heartbeatMs);
    heartbeat.unref();
  });
  app.addHook("onClose", async () => {
    if (heartbeat) clearInterval(heartbeat);
  });
}
