import { db, sql, withSystemScope } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { observabilityEnv } from '@borradh-workspace/env/observability';
import { MONITORED_QUEUE_NAMES } from '@borradh-workspace/features/jobs';
import { logError, pingHeartbeat } from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';

/**
 * Every queue in the system, DERIVED from the job registry (queues + their
 * DLQs). This list used to be hand-written and covered 7 of 18 queues — the two
 * it was missing, `appointment-lifecycle` and `campaign-send`, are the two whose
 * backlog most directly means "customers aren't being contacted".
 *
 * Do not type a queue name into this file. Declare the queue in
 * `packages/features/src/jobs/queues.ts` and it appears here automatically.
 */
const QUEUE_NAMES = MONITORED_QUEUE_NAMES;

// postgres.js pool cap for remote (Neon) connections — used to compute saturation %.
const DB_POOL_MAX = 10;

interface DbMetrics {
  active: number;
  idle: number;
  idleInTxn: number;
  waiting: number;
  total: number;
  saturationPct: number;
}

interface RedisMetrics {
  connectedClients: number;
  usedMemoryMb: number;
  memFragmentationRatio: number;
  rejectedConnections: number;
  evictedKeys: number;
  commandsPerSec: number;
}

interface QueueMetrics {
  name: string;
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
  completed: number;
}

@Injectable()
export class MetricsCollectorService {
  private readonly logger = new Logger(MetricsCollectorService.name);
  private lastCommandsProcessed = 0;
  private lastCollectedAt = 0;

  @Cron('*/60 * * * * *')
  async collect(): Promise<void> {
    // Local dev has no BetterStack dashboard reading these, so the only effect
    // of collecting is a DB + Redis round-trip per minute and a log line that
    // drowns the dev output. Nothing consumes it — skip the whole tick.
    if (apiEnv.NODE_ENV === 'development') return;

    // Scheduler-liveness heartbeat: reaching this tick proves the NestJS cron
    // engine is firing. If it stops, every scheduled job dies at once and this
    // Better Stack heartbeat goes red.
    void pingHeartbeat(observabilityEnv.BETTERSTACK_SCHEDULER_HEARTBEAT_URL);

    try {
      const [dbResult, redisResult, queuesResult] = await Promise.allSettled([
        this.collectDb(),
        this.collectRedis(),
        this.collectQueues(),
      ]);

      const db = dbResult.status === 'fulfilled' ? dbResult.value : null;
      const redis =
        redisResult.status === 'fulfilled' ? redisResult.value : null;
      const queues =
        queuesResult.status === 'fulfilled' ? queuesResult.value : [];

      // Flat log structure so BetterStack metric expressions can use simple
      // JSONExtract(raw, 'field_name', 'Nullable(Type)') without nested paths.
      //
      // DERIVED from whatever queues exist: one set of fields per queue, dashes
      // → underscores (`q_<queue>_waiting|active|failed|delayed`). The field
      // names are unchanged for the queues that were already emitted, so
      // existing BetterStack metric expressions keep working — but a NEW queue
      // now shows up on its own instead of waiting for someone to remember.
      const queueFields = Object.fromEntries(
        queues.flatMap((q) => {
          const key = q.name.replace(/-/g, '_');
          return [
            [`q_${key}_waiting`, q.waiting],
            [`q_${key}_active`, q.active],
            [`q_${key}_failed`, q.failed],
            [`q_${key}_delayed`, q.delayed],
          ];
        })
      );

      this.logger.log({
        event: 'metrics.collect',

        // DB connection pool
        db_active: db?.active ?? null,
        db_idle: db?.idle ?? null,
        db_idle_in_txn: db?.idleInTxn ?? null,
        db_waiting: db?.waiting ?? null,
        db_total: db?.total ?? null,
        db_saturation_pct: db?.saturationPct ?? null,

        // Redis
        redis_connected_clients: redis?.connectedClients ?? null,
        redis_used_memory_mb: redis?.usedMemoryMb ?? null,
        redis_mem_fragmentation_ratio: redis?.memFragmentationRatio ?? null,
        redis_rejected_connections: redis?.rejectedConnections ?? null,
        redis_evicted_keys: redis?.evictedKeys ?? null,
        redis_commands_per_sec: redis?.commandsPerSec ?? null,

        // BullMQ queues (one set of fields per queue, dashes → underscores)
        ...queueFields,

        // Collect errors (non-null only when a sub-collector failed)
        collect_errors: [
          dbResult.status === 'rejected' ? `db: ${dbResult.reason}` : null,
          redisResult.status === 'rejected'
            ? `redis: ${redisResult.reason}`
            : null,
          queuesResult.status === 'rejected'
            ? `queues: ${queuesResult.reason}`
            : null,
        ].filter(Boolean),
      });
    } catch (error) {
      logError('metrics.collect', error, { feature: 'health' });
    }
  }

  private async collectDb(): Promise<DbMetrics> {
    return withSystemScope(async () => {
      const rows = await db.execute(sql`
        SELECT
          count(*) FILTER (WHERE state = 'active')            AS active,
          count(*) FILTER (WHERE state = 'idle')              AS idle,
          count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_txn,
          count(*) FILTER (WHERE wait_event_type = 'Lock')    AS waiting,
          count(*)                                            AS total
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
      `);

      const row = rows[0] as Record<string, unknown>;
      const active = Number(row.active ?? 0);
      const idle = Number(row.idle ?? 0);
      const idleInTxn = Number(row.idle_in_txn ?? 0);
      const waiting = Number(row.waiting ?? 0);
      const total = Number(row.total ?? 0);

      return {
        active,
        idle,
        idleInTxn,
        waiting,
        total,
        saturationPct: Math.round((active / DB_POOL_MAX) * 100),
      };
    });
  }

  private async collectRedis(): Promise<RedisMetrics> {
    const client = getRedis();
    const info = await client.info();

    const get = (key: string): number => {
      const match = new RegExp(`^${key}:(\\S+)$`, 'm').exec(info);
      if (!match) return 0;
      return Number.parseFloat(match[1]);
    };

    const usedMemoryBytes = get('used_memory_rss');
    const totalCommandsProcessed = get('total_commands_processed');

    const now = Date.now();
    const elapsedSec =
      this.lastCollectedAt > 0
        ? Math.max((now - this.lastCollectedAt) / 1000, 1)
        : 60;
    const commandsDelta = Math.max(
      totalCommandsProcessed - this.lastCommandsProcessed,
      0
    );
    this.lastCommandsProcessed = totalCommandsProcessed;
    this.lastCollectedAt = now;

    return {
      connectedClients: get('connected_clients'),
      usedMemoryMb: Math.round((usedMemoryBytes / 1024 / 1024) * 10) / 10,
      memFragmentationRatio: get('mem_fragmentation_ratio'),
      rejectedConnections: get('rejected_connections'),
      evictedKeys: get('evicted_keys'),
      commandsPerSec: Math.round(commandsDelta / elapsedSec),
    };
  }

  private async collectQueues(): Promise<QueueMetrics[]> {
    const prefix = getBullMqPrefix();
    const connection = getRedis();

    const results = await Promise.allSettled(
      QUEUE_NAMES.map(async (name) => {
        const queue = new Queue(name, {
          connection,
          prefix,
        });
        try {
          const counts = await queue.getJobCounts(
            'waiting',
            'active',
            'failed',
            'delayed',
            'completed'
          );
          return {
            name,
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            failed: counts.failed ?? 0,
            delayed: counts.delayed ?? 0,
            completed: counts.completed ?? 0,
          };
        } finally {
          await queue.close();
        }
      })
    );

    return results
      .filter(
        (r): r is PromiseFulfilledResult<QueueMetrics> =>
          r.status === 'fulfilled'
      )
      .map((r) => r.value);
  }
}
