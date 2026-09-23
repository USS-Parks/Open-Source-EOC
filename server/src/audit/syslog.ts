import { createSocket } from "node:dgram";
import { connect, isIP } from "node:net";
import { hostname } from "node:os";
import type { Sql } from "../db/client.js";

/**
 * Optional forwarding of the audit trail to a syslog collector, one RFC 5424
 * message per event, configured by OPENEOC_SYSLOG_URL. The scheduler runs it,
 * so no write path waits on the network. Each pass reads events after a
 * stored mark, in an order that never passes an event whose transaction
 * commits late (see audit_forward_batch), sends them, and only then moves the
 * mark. A failed send is retried on the next pass, so every event reaches the
 * collector once in normal operation and at least once after a failure.
 */

export interface SyslogTarget {
  readonly protocol: "udp" | "tcp";
  readonly host: string;
  readonly port: number;
}

/** `udp://host:514` or `tcp://host:514`; unset or empty turns forwarding off. */
export function syslogTarget(raw: string | undefined): SyslogTarget | null {
  if (!raw) return null;
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    // Reported below.
  }
  const protocol = url?.protocol.slice(0, -1);
  if (!url || (protocol !== "udp" && protocol !== "tcp") || !url.hostname)
    throw new Error(`unsupported OPENEOC_SYSLOG_URL: ${raw}`);
  return {
    protocol,
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: url.port ? Number(url.port) : 514,
  };
}

const BATCH = 500;
// Facility 13 (log audit), severity 6 (informational).
const PRI = "<110>";
const HOST = hostname().replace(/[^!-~]/g, "").slice(0, 255) || "-";
// ponytail: a UDP message is cut at 8 KiB, the common collector default; use
// TCP for events larger than that.
const UDP_MAX_BYTES = 8192;

/** Forward every pending audit event; returns how many were sent. */
export async function forwardAudit(sql: Sql, target: SyslogTarget): Promise<number> {
  let sent = 0;
  for (;;) {
    const rows = await sql`select * from audit_forward_batch(${BATCH})`;
    if (rows.length === 0) return sent;
    await send(target, rows.map(syslogMessage));
    const last = rows.at(-1)!;
    await sql`select audit_forward_advance(${last.xact as string}::xid8, ${last.seq as string}::bigint)`;
    sent += rows.length;
    if (rows.length < BATCH) return sent;
  }
}

function syslogMessage(row: Record<string, unknown>): string {
  const at = new Date(row.created_at as string).toISOString();
  const event = {
    seq: Number(row.seq),
    id: row.id,
    at,
    jurisdictionId: row.jurisdiction_id,
    incidentId: row.incident_id,
    personId: row.person_id,
    person: row.person,
    positionId: row.position_id,
    category: row.category,
    subjectTable: row.subject_table,
    subjectId: row.subject_id,
    corrects: row.corrects,
    payload: row.payload,
  };
  return `${PRI}1 ${at} ${HOST} openeoc ${process.pid} audit - ${JSON.stringify(event)}`;
}

async function send(target: SyslogTarget, messages: string[]): Promise<void> {
  if (target.protocol === "udp") {
    const socket = createSocket(isIP(target.host) === 6 ? "udp6" : "udp4");
    try {
      for (const message of messages) {
        const bytes = Buffer.from(message, "utf8").subarray(0, UDP_MAX_BYTES);
        await new Promise<void>((resolve, reject) =>
          socket.send(bytes, target.port, target.host, (err) => (err ? reject(err) : resolve())),
        );
      }
    } finally {
      socket.close();
    }
    return;
  }
  // RFC 6587 octet counting: each message is preceded by its length and a space.
  const frames = Buffer.concat(
    messages.flatMap((message) => {
      const bytes = Buffer.from(message, "utf8");
      return [Buffer.from(`${bytes.length} `), bytes];
    }),
  );
  await new Promise<void>((resolve, reject) => {
    const socket = connect(target.port, target.host);
    socket.setTimeout(10_000, () => socket.destroy(new Error("syslog connection timed out")));
    socket.once("error", reject);
    socket.once("finish", () => {
      socket.destroy();
      resolve();
    });
    socket.end(frames);
  });
}
