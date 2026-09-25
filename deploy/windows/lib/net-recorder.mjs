import { appendFileSync } from "node:fs";
import dgram from "node:dgram";
import dns from "node:dns";
import net from "node:net";

/**
 * Records every network destination a Node process asks for: each TCP or
 * TLS connection (HTTP, fetch, WebSocket and PostgreSQL clients all open one
 * through net.Socket), each name looked up, and each UDP datagram sent. The
 * air-gap proof loads it into every Node process the system starts, through
 * NODE_OPTIONS=--import, and writes one JSON line per attempt to the file in
 * OPENEOC_NET_RECORD. It observes; it never blocks or changes a call.
 */

const file = process.env.OPENEOC_NET_RECORD;

function record(kind, target) {
  try {
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, kind, ...target })}\n`);
  } catch {
    // A recorder that cannot write must not break the process it watches.
  }
}

/** The destination of a net.Socket#connect call, in any of its argument forms. */
function destination(args) {
  const [first, second] = Array.isArray(args[0]) ? args[0] : args;
  if (first !== null && typeof first === "object") {
    return first.path ? { kind: "ipc", path: String(first.path) } : { kind: "tcp", host: first.host ?? "localhost", port: Number(first.port) };
  }
  if (typeof first === "string" && !/^\d+$/.test(first)) return { kind: "ipc", path: first };
  return { kind: "tcp", host: typeof second === "string" ? second : "localhost", port: Number(first) };
}

if (file) {
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function recordedConnect(...args) {
    const { kind, ...target } = destination(args);
    record(kind, target);
    return connect.apply(this, args);
  };

  for (const name of ["lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny", "resolveSrv", "resolveTxt", "reverse"]) {
    for (const api of [dns, dns.promises]) {
      const original = api[name];
      if (typeof original !== "function") continue;
      api[name] = function recordedLookup(host, ...rest) {
        record("dns", { call: name, host: String(host) });
        return original.call(this, host, ...rest);
      };
    }
  }

  const send = dgram.Socket.prototype.send;
  dgram.Socket.prototype.send = function recordedSend(...args) {
    // send(msg[, offset, length][, port][, address][, callback])
    const numbers = args.filter((value) => typeof value === "number");
    const address = args.find((value, index) => index > 0 && typeof value === "string");
    record("udp", { host: address ?? "connected", port: numbers.length >= 3 ? numbers[2] : numbers[0] ?? null });
    return send.apply(this, args);
  };
}
