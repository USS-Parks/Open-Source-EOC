import postgres from "postgres";
import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "../db/client.js";
import { withPerson } from "../db/context.js";
import { forwardAudit, syslogTarget } from "../audit/syslog.js";
import { principalForPerson, requireAdmin, type Principal } from "../auth/service.js";
import { readDueSmsReplies } from "../contacts/carriers.js";
import { runDueFeeds } from "../feeds/service.js";
import { runDueBriefings } from "../meetings/service.js";
import { runScheduledRules } from "../notify/engine.js";
import { runDueCalldowns } from "../notify/mass.js";
import { DeliveryWorker } from "../notify/outbox.js";
import { runDuePlans } from "../plans/service.js";
import { runDueReports } from "../reports/job.js";
import { purgeExpired } from "../retention/service.js";

/**
 * The in-process scheduler. Every node runs one; the node holding a
 * PostgreSQL session advisory lock is the leader and the only one that runs
 * the jobs: scheduled notification rules, due briefings, feed polls, the
 * outbox worker, mass notification call-downs, replies read from an SMS
 * gateway on the site network, scheduled reports, plan task
 * releases and review reminders, the retention purge and, when configured, audit forwarding to syslog. The others retry the lock on an interval, so when the leader
 * stops or its session ends one of them takes over. A brief overlap during a
 * handover is tolerated: rule firing and outbox claims are atomic, and feed
 * items upsert.
 *
 * The lock lives on a dedicated one-connection client rather than a reserved
 * pool connection: a reserved postgres.js connection that drops goes back to
 * the pool, and the stale handle would then run queries on another session.
 */

export type JobName = "rules" | "briefings" | "feeds" | "outbox" | "calldowns" | "replies" | "reports" | "plans" | "retention" | "syslog";

export interface SchedulerOptions {
  /** Connection string for the lock session; the entrypoint passes the runtime URL. */
  readonly lockUrl: string;
  readonly logger: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  /** Milliseconds between runs of each job; defaults come from the environment. */
  readonly intervals?: Partial<Record<JobName, number>>;
  /** Milliseconds between lock attempts, and between checks that the lock is still held. */
  readonly leaderRetryMs?: number;
  /** Run due briefings; defaults to the meetings integration being enabled. */
  readonly briefings?: boolean;
  /** Where to forward audit events; defaults to OPENEOC_SYSLOG_URL, and unset is off. */
  readonly syslogUrl?: string;
}

export interface SchedulerStatus {
  readonly leader: boolean;
  /** When each job last finished a run in this process, successful or not. */
  readonly lastRun: Partial<Record<JobName, Date>>;
}

const DEFAULT_MS: Record<JobName, number> = {
  rules: 30_000,
  briefings: 60_000,
  feeds: 60_000,
  outbox: 2_000,
  calldowns: 30_000,
  replies: 30_000,
  reports: 60_000,
  plans: 30_000,
  retention: 3_600_000,
  syslog: 10_000,
};

// ponytail: one fixed key per database; two applications sharing one database
// would need distinct keys.
const LOCK_KEY = 0x4f454f43;

interface Job {
  readonly name: JobName;
  readonly ms: number;
  readonly run: () => Promise<unknown>;
  timer: NodeJS.Timeout | null;
  running: Promise<void> | null;
}

export class Scheduler {
  readonly delivery: DeliveryWorker;
  private readonly lock: Sql;
  private readonly log: SchedulerOptions["logger"];
  private readonly retryMs: number;
  private readonly jobs: Job[];
  private readonly lastRun: Partial<Record<JobName, Date>> = {};
  private leaderPid: number | null = null;
  private electionTimer: NodeJS.Timeout | null = null;
  private electing: Promise<void> | null = null;
  private stopped = true;

  constructor(
    private readonly sql: Sql,
    options: SchedulerOptions,
  ) {
    this.log = options.logger;
    this.delivery = new DeliveryWorker(sql, { logger: options.logger });
    this.lock = postgres(options.lockUrl, {
      max: 1,
      max_lifetime: null,
      onnotice: () => undefined,
    });
    this.retryMs = options.leaderRetryMs ?? msFromEnv("OPENEOC_SCHEDULER_LEADER_MS", 10_000);
    const syslog = syslogTarget(options.syslogUrl ?? process.env.OPENEOC_SYSLOG_URL);
    const runs: Record<JobName, () => Promise<unknown>> = {
      rules: () => this.runRules(),
      briefings: () => this.runBriefings(),
      feeds: () => runDueFeeds(this.sql),
      outbox: () => this.delivery.drain(),
      calldowns: () => this.runCalldowns(),
      replies: () => readDueSmsReplies(this.sql, this.log),
      reports: () => runDueReports(this.sql, new Date(), { logger: this.log }),
      plans: () => this.runPlans(),
      retention: () => this.runRetention(),
      syslog: () => (syslog ? forwardAudit(this.sql, syslog) : Promise.resolve(0)),
    };
    const briefings = options.briefings ?? meetingsEnabled();
    this.jobs = (Object.keys(runs) as JobName[])
      .filter((name) => (name !== "briefings" || briefings) && (name !== "syslog" || syslog))
      .map((name) => ({
        name,
        ms:
          options.intervals?.[name] ??
          msFromEnv(`OPENEOC_SCHEDULER_${name.toUpperCase()}_MS`, DEFAULT_MS[name]),
        run: runs[name],
        timer: null,
        running: null,
      }));
  }

  status(): SchedulerStatus {
    return { leader: this.leaderPid !== null, lastRun: { ...this.lastRun } };
  }

  /** Begin contending for the lock. An instance is started and stopped once. */
  start(): void {
    this.stopped = false;
    this.elect();
  }

  /** Stop the jobs, wait for runs in flight, and end the lock session. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.electionTimer) clearTimeout(this.electionTimer);
    await this.electing;
    await this.stepDown();
    // Ending the session releases the lock.
    await this.lock.end({ timeout: 5 });
  }

  private elect(): void {
    this.electing = this.contend()
      .catch(async (err: unknown) => {
        this.log.warn({ err }, "scheduler lock check failed");
        await this.stepDown();
      })
      .finally(() => {
        this.electing = null;
        if (this.stopped) return;
        this.electionTimer = setTimeout(() => this.elect(), this.retryMs);
        this.electionTimer.unref();
      });
  }

  private async contend(): Promise<void> {
    if (this.leaderPid !== null) {
      // A replaced connection is a new session that does not hold the lock.
      const [row] = await this.lock`select pg_backend_pid() as pid`;
      if (row?.pid !== this.leaderPid) {
        this.log.warn("scheduler lock session was lost");
        await this.stepDown();
      }
      return;
    }
    const [row] = await this.lock`
      select pg_try_advisory_lock(${LOCK_KEY}::bigint) as held, pg_backend_pid() as pid`;
    if (!row?.held || this.stopped) return;
    this.leaderPid = row.pid as number;
    this.log.info({ jobs: this.jobs.map((j) => j.name) }, "scheduler leader elected");
    for (const job of this.jobs) this.tick(job);
  }

  private async stepDown(): Promise<void> {
    if (this.leaderPid === null) return;
    this.leaderPid = null;
    for (const job of this.jobs) {
      if (job.timer) clearTimeout(job.timer);
      job.timer = null;
    }
    await Promise.all(this.jobs.map((job) => job.running));
  }

  /** Run a job now and again `ms` after it finishes, so a run never overlaps itself. */
  private tick(job: Job): void {
    job.timer = null;
    if (this.leaderPid === null || this.stopped) return;
    job.running = job
      .run()
      .then(
        () => undefined,
        (err: unknown) => this.log.error({ err, job: job.name }, "scheduled job failed"),
      )
      .finally(() => {
        this.lastRun[job.name] = new Date();
        job.running = null;
        if (this.leaderPid === null || this.stopped) return;
        job.timer = setTimeout(() => this.tick(job), job.ms);
        job.timer.unref();
      });
  }

  private async runRules(): Promise<void> {
    const now = new Date();
    await this.forEachDue("rules", now, async (actor, jurisdictionId) => {
      requireAdmin(actor, jurisdictionId);
      await runScheduledRules(this.sql, actor, jurisdictionId, now);
    });
  }

  private async runCalldowns(): Promise<void> {
    const now = new Date();
    await this.forEachDue("calldowns", now, (actor, jurisdictionId) =>
      runDueCalldowns(this.sql, actor, jurisdictionId, now),
    );
  }

  private async runPlans(): Promise<void> {
    const now = new Date();
    await this.forEachDue("plans", now, (actor, jurisdictionId) =>
      withPerson(this.sql, actor.person.id, (tx) => runDuePlans(tx, actor, jurisdictionId, now)),
    );
  }

  private async runRetention(): Promise<void> {
    const purged = await purgeExpired(this.sql);
    if (Object.keys(purged).length > 0) this.log.info({ purged }, "retention purge");
  }

  private async runBriefings(): Promise<void> {
    await this.forEachDue("briefings", new Date(), (actor, jurisdictionId) =>
      withPerson(this.sql, actor.person.id, (tx) => runDueBriefings(tx, actor, jurisdictionId)),
    );
  }

  /**
   * Run `fn` once per jurisdiction with work due, as the admin the database
   * names for it. One jurisdiction's failure is logged and does not hold back
   * the rest.
   */
  private async forEachDue(
    work: "rules" | "briefings" | "calldowns" | "plans",
    now: Date,
    fn: (actor: Principal, jurisdictionId: string) => Promise<unknown>,
  ): Promise<void> {
    const due = await this.sql`select * from scheduler_due(${work}, ${now})`;
    for (const row of due) {
      const jurisdictionId = row.jurisdiction_id as string;
      try {
        await fn(await principalForPerson(this.sql, row.person_id as string), jurisdictionId);
      } catch (err) {
        this.log.error({ err, job: work, jurisdictionId }, "scheduled job failed for a jurisdiction");
      }
    }
  }
}

function msFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`unsupported ${name}: ${raw}`);
  return value;
}

function meetingsEnabled(): boolean {
  return (process.env.OPENEOC_INTEGRATIONS ?? "").split(",").some((s) => s.trim() === "meetings");
}
