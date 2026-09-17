import { getAppVersion } from '@borradh-workspace/observability';
import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/index.js';
import {
  type HealthCheckResult,
  runReadinessChecks,
} from './readiness-checks.js';

/** Database name only — never the host, user or password. */
const databaseName = (): string | null => {
  try {
    return (
      new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, '') ||
      null
    );
  } catch {
    return null;
  }
};

/** Logical Redis db index (`redis://host:6379/3` → 3). Defaults to 0. */
const redisDbIndex = (): number | null => {
  try {
    const p = new URL(process.env.REDIS_URL ?? '').pathname.replace(/^\//, '');
    return p === '' ? 0 : Number(p);
  } catch {
    return null;
  }
};

/**
 * Health check endpoints for BetterStack uptime monitoring.
 *
 * Endpoints:
 * - GET /health - Basic health check (fast, for frequent polling)
 * - GET /health/ready - Readiness check (includes DB + Redis check)
 * - GET /health/live - Liveness check (is the process alive)
 * - GET /health/identity - Which stack is this? (non-production only)
 */
@Controller('health')
@SkipThrottle()
export class HealthController {
  private readonly startTime = Date.now();

  /**
   * Basic health check - returns 200 if API is responding.
   * Use this for frequent uptime monitoring (every 30s-1min).
   */
  @Get()
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: getAppVersion(),
      // Short SHA (git's default 7-char form). Exposed so preview consumers can
      // wait for the new image to be live before running tests — without
      // it, /health returns 200 from the previous deploy and the suite
      // runs against stale code. Set per-deploy via pr-preview.yml's
      // "Set Fly secrets — API" step.
      sha: (process.env.COMMIT_SHA || 'unknown').slice(0, 7),
    };
  }

  /**
   * Liveness probe - is the process alive and responding?
   * Kubernetes/ECS uses this to determine if container should be restarted.
   */
  @Get('live')
  getLiveness() {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  /**
   * WHICH stack is answering — not whether one is.
   *
   * With ~90 worktrees on one machine, `curl localhost:3000/health` returning
   * 200 proves only that SOME api is up; it is routinely a different branch's,
   * pointed at a different database. Every symptom of that ("this user already
   * exists", "my seeded org isn't there", "the migration I just wrote isn't
   * applied") presents as an application bug. This endpoint lets a caller —
   * `local-stack status`, the e2e preflight — assert the answer came from the
   * stack it meant to talk to, and name the mismatch when it didn't.
   *
   * Non-production only, and deliberately narrow: the database NAME and the
   * process cwd, never a host, credential or connection string.
   */
  @Public()
  @Get('identity')
  getIdentity() {
    if (process.env.NODE_ENV === 'production') {
      throw new HttpException('Not Found', HttpStatus.NOT_FOUND);
    }

    return {
      sha: (process.env.COMMIT_SHA || 'unknown').slice(0, 7),
      version: getAppVersion(),
      database: databaseName(),
      redisDb: redisDbIndex(),
      apiUrl: process.env.API_URL ?? null,
      webUrl: process.env.WEB_URL ?? null,
      // The worktree this process was started from — the single most useful
      // field when two stacks are fighting over a port.
      cwd: process.cwd(),
      pid: process.pid,
    };
  }

  /**
   * Readiness check - can the service handle requests?
   * Includes dependency checks (database, redis).
   * Use this for deeper health monitoring (every 5min).
   */
  @Get('ready')
  async getReadiness(): Promise<HealthCheckResult> {
    const result = await runReadinessChecks(this.startTime);
    if (result.status !== 'healthy') {
      throw new HttpException(result, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}
