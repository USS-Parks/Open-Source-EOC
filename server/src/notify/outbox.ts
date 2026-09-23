import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "../db/client.js";
import { decryptSecret } from "../secrets/envelope.js";
import { markDelivered } from "../federation/service.js";

/**
 * The outbound delivery worker. Board writes queue webhooks and pushes in
 * delivery_outbox inside their own transaction; this sends them. A failed
 * attempt is retried with exponential backoff and jitter until it succeeds or
 * exhausts its attempts, when it is dead-lettered and its notification marks
 * failed. A target that keeps failing opens a circuit, and its deliveries are
 * deferred without spending attempts until the circuit cools.
 *
 * The same pass pushes the federation outbox to every peer with a link. Those
 * entries never dead-letter: store-and-forward holds through a partition of
 * any length, so they back off and wait.
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
  /** Retries, dead letters and deferred federation pushes are logged here. */
  readonly logger?: Pick<FastifyBaseLogger, "warn" | "error">;
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
  private readonly log: Pick<FastifyBaseLogger, "warn" | "error"> | null;
  private readonly totals = { delivered: 0, retried: 0, dead: 0, deferred: 0, federated: 0 };
  // ponytail: per-process breaker state; a second node keeps its own, which
  // only means each node probes a dead target on its own schedule.
  private readonly circuits = new Map<string, Circuit>();
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;
  private stopped = false;

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
    this.log = options.logger ?? null;
  }

  /** Outcomes since this worker was created, for the metrics endpoint. */
  stats(): DrainResult {
    return { ...this.totals };
  }

  /** Poll every `intervalMs` until {@link stop}. */
  start(intervalMs = 2_000): void {
    this.stopped = false;
    const tick = (): void => {
      if (this.stopped) return;
      this.running = this.drain()
        .catch((err: unknown) => {
          if (this.log) this.log.error({ err }, "delivery worker pass failed");
          else console.error("[openeoc] delivery worker pass failed", err);
        })
        .finally(() => {
          this.running = null;
          if (!this.stopped) {
            this.timer = setTimeout(tick, intervalMs);
            this.timer.unref();
          }
        });
    };
    tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running;
  }

  /** One pass over everything due. Tests call this directly. */
  async drain(): Promise<DrainResult> {
    const counts = { delivered: 0, retried: 0, dead: 0, deferred: 0, federated: 0 };
    const leaseSeconds = Math.ceil(this.timeoutMs / 1000) + 30;
    const rows = await this.sql`select * from claim_deliveries(${this.batch}, ${leaseSeconds})`;
    await Promise.all(
      rows.map(async (row) => {
        const outcome = await this.deliverOne(
          row.id as string,
          row.target as string,
          row.headers as Record<string, string>,
          row.body as string,
          Number(row.attempts),
        );
        counts[outcome] += 1;
      }),
    );
    counts.federated = await this.drainFederation();
    for (const outcome of Object.keys(counts) as (keyof DrainResult)[]) {
      this.totals[outcome] += counts[outcome];
    }
    return counts;
  }

  private async deliverOne(
    id: string,
    target: string,
    headers: Record<string, string>,
    body: string,
    attempts: number,
  ): Promise<"delivered" | "retried" | "dead" | "deferred"> {
    const key = circuitKey(target);
    const circuit = this.circuits.get(key);
    if (circuit && circuit.openUntil > this.now()) {
      await this.settle(id, "deferred", "circuit open", new Date(circuit.openUntil));
      return "deferred";
    }
    try {
      const res = await fetch(target, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) throw new Error(`target responded ${res.status}`);
      this.circuits.delete(key);
      await this.settle(id, "delivered", null, null);
      return "delivered";
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.recordFailure(key);
      // The origin only: a webhook URL can carry its secret in the path.
      const fields = {
        deliveryId: id,
        target: key,
        attempts,
        error,
        cause: err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined,
      };
      if (attempts >= this.maxAttempts) {
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
  ): Promise<void> {
    await this.sql`select settle_delivery(${id}, ${outcome}, ${error}, ${retryAt})`;
  }
}

function circuitKey(target: string): string {
  try {
    return new URL(target).origin;
  } catch {
    return target;
  }
}
