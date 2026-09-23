import type { ConnectionOptions } from "node:tls";
import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "../db/client.js";
import { decryptSecret } from "../secrets/envelope.js";
import { markDelivered } from "../federation/service.js";
import { destinationRefusal, type Resolve } from "./allowlist.js";
import { channelKey, channelRefusal, sendMessage, type StoredChannel } from "./channels.js";
import { SmtpRefused } from "./smtp.js";

/**
 * The outbound delivery worker. Board writes queue webhooks, pushes, email
 * and SMS in delivery_outbox inside their own transaction; this sends each by
 * its kind and keeps what the relay or provider answered. A failed
 * attempt is retried with exponential backoff and jitter until it succeeds or
 * exhausts its attempts, when it is dead-lettered and its notification marks
 * failed. A target that keeps failing opens a circuit, and its deliveries are
 * deferred without spending attempts until the circuit cools.
 *
 * The same pass pushes the federation outbox to every peer with a link. Those
 * entries never dead-letter: store-and-forward holds through a partition of
 * any length, so they back off and wait.
 *
 * A destination that is no longer on its jurisdiction's allowlist, or that a
 * host-suffix entry lets resolve to a private address, is dead-lettered
 * without being contacted, as is email or SMS for a jurisdiction that has not
 * configured that channel. An email circuit is its relay and an SMS circuit
 * its provider, never the recipient.
 *
 * The worker acts for no person. It reaches the queue only through the
 * narrow SECURITY DEFINER functions in the delivery migration.
 */

export interface DeliveryWorkerOptions {
  readonly batch?: number;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly breakerThreshold?: number;
  readonly breakerCooldownMs?: number;
  readonly now?: () => number;
  /** Host resolution for the private-address check; the system resolver by default. */
  readonly resolve?: Resolve;
  /** Retries, dead letters and deferred federation pushes are logged here. */
  readonly logger?: Pick<FastifyBaseLogger, "warn" | "error">;
  /** Extra TLS options for SMTP relays, such as a private CA. */
  readonly smtpTls?: ConnectionOptions;
}

export interface DrainResult {
  readonly delivered: number;
  readonly retried: number;
  readonly dead: number;
  readonly deferred: number;
  readonly federated: number;
}

interface Circuit {
  failures: number;
  openUntil: number;
}

export class DeliveryWorker {
  private readonly batch: number;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly breakerThreshold: number;
  private readonly breakerCooldownMs: number;
  private readonly now: () => number;
  private readonly resolve: Resolve | undefined;
  private readonly log: Pick<FastifyBaseLogger, "warn" | "error"> | null;
  private readonly smtpTls: ConnectionOptions | undefined;
  private readonly totals = { delivered: 0, retried: 0, dead: 0, deferred: 0, federated: 0 };
  // ponytail: per-process breaker state; a second node keeps its own, which
  // only means each node probes a dead target on its own schedule.
  private readonly circuits = new Map<string, Circuit>();

  constructor(
    private readonly sql: Sql,
    options: DeliveryWorkerOptions = {},
  ) {
    this.batch = options.batch ?? 25;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxAttempts = options.maxAttempts ?? 8;
    this.baseDelayMs = options.baseDelayMs ?? 5_000;
    this.maxDelayMs = options.maxDelayMs ?? 15 * 60_000;
    this.breakerThreshold = options.breakerThreshold ?? 5;
    this.breakerCooldownMs = options.breakerCooldownMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.resolve = options.resolve;
    this.log = options.logger ?? null;
    this.smtpTls = options.smtpTls;
  }

  /** Outcomes since this worker was created, for the metrics endpoint. */
  stats(): DrainResult {
    return { ...this.totals };
  }

  /** One pass over everything due. The scheduler runs it on an interval; tests call it directly. */
  async drain(): Promise<DrainResult> {
    const counts = { delivered: 0, retried: 0, dead: 0, deferred: 0, federated: 0 };
    const leaseSeconds = Math.ceil(this.timeoutMs / 1000) + 30;
    const rows = await this.sql`select * from claim_deliveries(${this.batch}, ${leaseSeconds})`;
    await Promise.all(
      rows.map(async (row) => {
        const outcome = await this.deliverOne(row as unknown as Claimed);
        counts[outcome] += 1;
      }),
    );
    counts.federated = await this.drainFederation();
    for (const outcome of Object.keys(counts) as (keyof DrainResult)[]) {
      this.totals[outcome] += counts[outcome];
    }
    return counts;
  }

  private async deliverOne(row: Claimed): Promise<"delivered" | "retried" | "dead" | "deferred"> {
    const { id, kind, target, headers, body, allowlist } = row;
    const attempts = Number(row.attempts);
    const message = kind === "email" || kind === "sms";
    const refused = message
      ? await channelRefusal(kind, row.channel, allowlist, this.resolve)
      : await destinationRefusal(allowlist, target, this.resolve);
    if (refused) {
      this.log?.error({ deliveryId: id, target: message ? kind : circuitKey(target), error: refused }, "delivery refused");
      await this.settle(id, "dead", refused, null);
      return "dead";
    }
    const key = message ? channelKey(kind, row.channel!) : circuitKey(target);
    const circuit = this.circuits.get(key);
    if (circuit && circuit.openUntil > this.now()) {
      await this.settle(id, "deferred", "circuit open", new Date(circuit.openUntil));
      return "deferred";
    }
    try {
      let receipt: Record<string, unknown> | null = null;
      if (message) {
        receipt = await sendMessage(
          kind,
          row.channel!,
          { jurisdictionId: row.jurisdiction_id, to: target, subject: headers.subject ?? "", body },
          { timeoutMs: this.timeoutMs, tls: this.smtpTls },
        );
      } else {
        const res = await fetch(target, {
          method: "POST",
          headers,
          body,
          // A redirect could lead anywhere, including off the allowlist.
          redirect: "manual",
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) throw new Error(`target responded ${res.status}`);
      }
      this.circuits.delete(key);
      await this.settle(id, "delivered", null, null, receipt);
      return "delivered";
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      // A relay refusing this recipient or message is working; it is not a failing target.
      if (!(err instanceof SmtpRefused)) this.recordFailure(key);
      // The origin only: a webhook URL can carry its secret in the path.
      const fields = {
        deliveryId: id,
        target: key,
        attempts,
        error,
        cause: err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined,
      };
      if (attempts >= this.maxAttempts || err instanceof SmtpRefused) {
        this.log?.error(fields, "delivery dead-lettered");
        await this.settle(id, "dead", error, null);
        return "dead";
      }
      this.log?.warn(fields, "delivery retry scheduled");
      await this.settle(id, "retry", error, new Date(this.now() + this.backoff(attempts)));
      return "retried";
    }
  }

  private async drainFederation(): Promise<number> {
    const batches = await this.sql`select * from claim_federation_batches(${this.batch})`;
    let delivered = 0;
    for (const b of batches) {
      const ids = b.ids as string[];
      const url = `${String(b.endpoint_url).replace(/\/$/, "")}/api/v1/federation/receive`;
      const key = circuitKey(url);
      const circuit = this.circuits.get(key);
      if (circuit && circuit.openUntil > this.now()) continue;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-peer-token": decryptSecret(b.outbound_token as string),
          },
          body: JSON.stringify({
            boardId: b.remote_board_id as string,
            updates: (b.updates as Buffer[]).map((u) => Buffer.from(u).toString("base64")),
          }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) throw new Error(`peer responded ${res.status}`);
        this.circuits.delete(key);
        await markDelivered(this.sql, ids);
        delivered += ids.length;
      } catch (err) {
        this.recordFailure(key);
        const error = err instanceof Error ? err.message : String(err);
        const retryAt = new Date(this.now() + this.backoff(this.circuits.get(key)?.failures ?? 1));
        this.log?.warn(
          { peerId: b.peer_id as string, entries: ids.length, error },
          "federation push deferred",
        );
        await this.sql`select defer_federation(${ids}::uuid[], ${retryAt}, ${error})`;
      }
    }
    return delivered;
  }

  private recordFailure(key: string): void {
    const circuit = this.circuits.get(key) ?? { failures: 0, openUntil: 0 };
    circuit.failures += 1;
    if (circuit.failures >= this.breakerThreshold) {
      circuit.openUntil = this.now() + this.breakerCooldownMs;
    }
    this.circuits.set(key, circuit);
  }

  /** Exponential backoff with full jitter over the upper half of the window. */
  private backoff(attempts: number): number {
    const ceiling = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** Math.max(0, attempts - 1));
    return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
  }

  private async settle(
    id: string,
    outcome: "delivered" | "retry" | "dead" | "deferred",
    error: string | null,
    retryAt: Date | null,
    receipt: Record<string, unknown> | null = null,
  ): Promise<void> {
    const stored = receipt ? this.sql.json(receipt as never) : null;
    await this.sql`select settle_delivery(${id}, ${outcome}, ${error}, ${retryAt}, ${stored}::jsonb)`;
  }
}

/** A row as claim_deliveries returns it. */
interface Claimed {
  readonly id: string;
  readonly kind: "webhook" | "ntfy" | "email" | "sms";
  readonly target: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly attempts: number;
  readonly allowlist: string[];
  readonly jurisdiction_id: string;
  /** The jurisdiction's email or SMS channel; null for other kinds or when unconfigured. */
  readonly channel: StoredChannel | null;
}

function circuitKey(target: string): string {
  try {
    return new URL(target).origin;
  } catch {
    return target;
  }
}
