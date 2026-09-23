import { EventEmitter } from "node:events";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { describe, expect, it, vi } from "vitest";
import { disciplineSockets } from "../sync/sockets.js";

function fakeApp(): {
  app: FastifyInstance;
  websocketServer: EventEmitter & { clients: Set<WebSocket> };
  ready(): Promise<void>;
  close(): Promise<void>;
} {
  const hooks: Partial<Record<"onReady" | "onClose", () => Promise<void> | void>> = {};
  const websocketServer = Object.assign(new EventEmitter(), { clients: new Set<WebSocket>() });
  const app = {
    websocketServer,
    addHook(name: "onReady" | "onClose", fn: () => Promise<void> | void) {
      hooks[name] = fn;
      return this;
    },
  } as unknown as FastifyInstance;
  return {
    app,
    websocketServer,
    ready: async () => { await hooks.onReady?.(); },
    close: async () => { await hooks.onClose?.(); },
  };
}

function fakeSocket(queued: number): WebSocket & { _socket: { writableLength: number } } {
  return Object.assign(new EventEmitter(), {
    OPEN: WebSocket.OPEN,
    bufferedAmount: 0,
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    ping: vi.fn(),
    _socket: { writableLength: queued },
  }) as unknown as WebSocket & { _socket: { writableLength: number } };
}

describe("socket backpressure discipline", () => {
  it("sheds a slow consumer when the transport queue is over budget", async () => {
    const harness = fakeApp();
    disciplineSockets(harness.app, { authDeadlineMs: 10_000, heartbeatMs: 60_000, maxBufferedBytes: 64 });
    await harness.ready();
    try {
      const socket = fakeSocket(65);
      const send = socket.send as ReturnType<typeof vi.fn>;
      const close = socket.close as ReturnType<typeof vi.fn>;
      harness.websocketServer.clients.add(socket);
      harness.websocketServer.emit("connection", socket);

      socket.send("frame");

      expect(send).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledWith(1013, "slow consumer");
    } finally {
      await harness.close();
    }
  });

  it("still sends when the combined queue is within budget", async () => {
    const harness = fakeApp();
    disciplineSockets(harness.app, { authDeadlineMs: 10_000, heartbeatMs: 60_000, maxBufferedBytes: 64 });
    await harness.ready();
    try {
      const socket = fakeSocket(32);
      const send = socket.send as ReturnType<typeof vi.fn>;
      const close = socket.close as ReturnType<typeof vi.fn>;
      harness.websocketServer.clients.add(socket);
      harness.websocketServer.emit("connection", socket);

      socket.send("frame");

      expect(send).toHaveBeenCalledWith("frame");
      expect(close).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });
});
