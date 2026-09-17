import {
  captureException,
  captureMessage,
  logError,
  logWarning,
  tracked,
  trackedResult,
} from '@borradh-workspace/observability';
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NonProductionGuard } from '../common/index.js';
import { withMarker } from './probe-marker.js';

/**
 * Debug Controller — fire test errors through every reporting path.
 *
 * During the Sentry → PostHog migration these endpoints let us confirm that
 * BOTH destinations receive each kind of error. Every backend error path now
 * dual-sends to PostHog Error Tracking alongside Sentry:
 *
 *   - raw throw          → Nest exception filter            (Sentry + PostHog)
 *   - logError(...)      → Pino + Sentry + PostHog          (handled path)
 *   - logWarning(...)    → Pino + Sentry + PostHog          (warning path)
 *   - tracked(...)       → captureException → Sentry + PostHog
 *   - trackedResult(...) → logError on exception            (Result path)
 *
 * After hitting one, check Sentry Issues AND PostHog → Error tracking for a
 * matching event. Everything these routes emit is prefixed `[synthetic]` and
 * tagged `synthetic: true`, so alerting can exclude it — without that, a probe
 * run is indistinguishable from a customer failure (it became Sentry issue
 * API-FE, then an automated incident PR).
 *
 * ACCESS: `NonProductionGuard` is class-level on purpose — a per-handler
 * first-line check is one a newly added route can silently omit. It is OFF
 * everywhere unless `DEBUG_ENDPOINTS_ENABLED=true`, impossible on real
 * production whatever the flags say, and on preview/staging (which inherit
 * `NODE_ENV=production`) additionally requires an `E2E_SEED_TOKEN` bearer token:
 *
 *   curl -H "Authorization: Bearer $E2E_SEED_TOKEN" \
 *     "https://<preview-api>/debug/error/log-warning?marker=probe"
 */
@Controller('debug')
@UseGuards(NonProductionGuard)
export class DebugController {
  private readonly logger = new Logger(DebugController.name);

  /**
   * Health check for debug endpoints — reports whether Sentry/PostHog are wired.
   */
  @Get('health')
  health() {
    return {
      status: 'ok',
      environment: process.env.NODE_ENV,
      sentryDsn: process.env.SENTRY_DSN ? 'configured' : 'not configured',
      posthogApiKey: process.env.POSTHOG_API_KEY
        ? 'configured'
        : 'not configured',
      message: 'Debug endpoints are available',
      paths: [
        'GET  /debug/error/unhandled    — raw throw (exception filter)',
        'GET  /debug/error/async        — async throw',
        'GET  /debug/error/type         — TypeError',
        'GET  /debug/error/http?status= — HttpException',
        'GET  /debug/error/log-error    — logError() handled path',
        'GET  /debug/error/log-warning?marker= — logWarning() handled path',
        'GET  /debug/error/tracked      — tracked() wrapper exception',
        'GET  /debug/error/tracked-result — trackedResult() exception',
        'GET  /debug/error/db-cause     — error with wrapped DB cause',
        'POST /debug/capture/message?message=',
        'POST /debug/capture/exception?message=',
      ],
    };
  }

  /**
   * Raw unhandled exception — caught by the global Nest exception filter,
   * which reports to Sentry + PostHog.
   */
  @Get('error/unhandled')
  triggerUnhandledError(@Query('marker') marker?: string) {
    this.logger.warn('Triggering unhandled error');
    throw new Error(withMarker('Test unhandled error', marker));
  }

  /**
   * HTTP exception with a chosen status (default 500).
   */
  @Get('error/http')
  triggerHttpError(@Query('status') status?: string) {
    const statusCode = status ? Number.parseInt(status, 10) : 500;
    this.logger.warn(`Triggering HTTP ${statusCode} error`);
    throw new HttpException(
      `Test HTTP error with status ${statusCode}`,
      statusCode || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }

  /**
   * Async throw — verifies async error handling reaches both destinations.
   */
  @Get('error/async')
  async triggerAsyncError() {
    this.logger.warn('Triggering async error');
    await new Promise((resolve) => setTimeout(resolve, 100));
    throw new Error('Test async error (debug endpoint)');
  }

  /**
   * TypeError — a common runtime error shape for grouping checks.
   */
  @Get('error/type')
  triggerTypeError() {
    this.logger.warn('Triggering type error');
    const obj: unknown = null;
    // @ts-expect-error - Intentionally triggering a TypeError
    return obj.nonExistentProperty;
  }

  /**
   * Handled error via logError() — the funnel services use in catch blocks.
   * Sends to Pino + Sentry + PostHog without throwing.
   *
   * `synthetic: 'true'` is the discriminator downstream alerting filters on.
   * Without it these events are indistinguishable from customer failures, which
   * is how a sink-probe run became Sentry issue API-FE and then an automated
   * incident PR.
   */
  @Get('error/log-error')
  triggerLogError(@Query('marker') marker?: string) {
    this.logger.log('Firing logError() handled path');
    logError(
      'debug.logError',
      new Error(withMarker('Test logError handled path', marker)),
      {
        feature: 'debug',
        tags: {
          source: 'debug-endpoint',
          path: 'log-error',
          synthetic: 'true',
        },
        extra: { marker, timestamp: new Date().toISOString() },
      }
    );
    return {
      success: true,
      path: 'log-error',
      marker,
      sentTo: ['sentry', 'posthog'],
    };
  }

  /**
   * Handled WARNING via logWarning() — the degraded-but-not-broken path.
   *
   * Kept distinct from `log-error` because this is the path that silently went
   * Sentry-only: PostHog received nothing warning-shaped for ~2 months. The
   * `marker` query param lets an automated check correlate one specific
   * invocation across both sinks (see scripts/verify-error-sinks.mjs).
   */
  @Get('error/log-warning')
  triggerLogWarning(@Query('marker') marker?: string) {
    this.logger.log('Firing logWarning() handled path');
    const message = withMarker('Test logWarning handled path', marker);
    logWarning('debug.logWarning', message, {
      feature: 'debug',
      tags: {
        source: 'debug-endpoint',
        path: 'log-warning',
        synthetic: 'true',
      },
      extra: { marker, timestamp: new Date().toISOString() },
    });
    return {
      success: true,
      path: 'log-warning',
      marker,
      sentTo: ['sentry', 'posthog'],
      // PostHog has no "message" concept, so the warning arrives as an
      // $exception tagged `$exception_level: 'warning'`.
      posthogEvent: '$exception ($exception_level=warning)',
    };
  }

  /**
   * Exception inside a tracked() wrapper — routes through captureException,
   * reaching Sentry + PostHog, then re-throws (caught here for a clean reply).
   */
  @Get('error/tracked')
  async triggerTrackedError(@Query('marker') marker?: string) {
    this.logger.log('Firing tracked() exception path');
    try {
      await tracked('debug.tracked', async () => {
        throw new Error(withMarker('Test tracked() exception', marker));
      });
    } catch {
      // tracked() already reported it; swallow so the endpoint replies cleanly.
    }
    return {
      success: true,
      path: 'tracked',
      marker,
      sentTo: ['sentry', 'posthog'],
    };
  }

  /**
   * Exception inside a trackedResult() wrapper — the Result-returning path used
   * by feature services. On throw it calls logError() (Sentry + PostHog) and
   * returns an error Result rather than throwing.
   */
  @Get('error/tracked-result')
  async triggerTrackedResultError(@Query('marker') marker?: string) {
    this.logger.log('Firing trackedResult() exception path');
    const result = await trackedResult('debug.trackedResult', async () => {
      throw new Error(withMarker('Test trackedResult() exception', marker));
    });
    return { success: true, path: 'tracked-result', marker, result };
  }

  /**
   * Error wrapping a DB-style cause — verifies the root-cause extraction and
   * Postgres field reporting (dbCode/dbConstraint…) in logError. Since
   * ENG-851 PostHog receives the WRAPPER as `$exception_list[0]` (its stack
   * carries the app frames the fingerprint keys on) with the DB cause as
   * `$exception_list[1]`; Sentry still receives the deepest cause.
   */
  @Get('error/db-cause')
  triggerDbCauseError() {
    this.logger.log('Firing logError() with wrapped DB cause');
    const cause = Object.assign(new Error('duplicate key value violates ...'), {
      code: '23505',
      detail: 'Key (email)=(test@example.com) already exists.',
      constraint_name: 'user_email_unique',
      table_name: 'user',
    });
    const wrapped = new Error(
      'Failed query: insert into "user" ... params: ...'
    );
    wrapped.cause = cause;
    logError('debug.dbCause', wrapped, {
      feature: 'debug',
      tags: { source: 'debug-endpoint', path: 'db-cause' },
    });
    return { success: true, path: 'db-cause', sentTo: ['sentry', 'posthog'] };
  }

  /**
   * Capture a custom message (Sentry only — PostHog Error Tracking is for
   * exceptions, not messages).
   */
  @Post('capture/message')
  captureMessage(@Query('message') message?: string) {
    const msg = message || 'Test message from debug endpoint';
    this.logger.log(`Capturing message: ${msg}`);
    captureMessage(msg, 'info');
    return {
      success: true,
      message: 'Message captured (Sentry)',
      sentMessage: msg,
    };
  }

  /**
   * Capture a custom exception via the captureException wrapper — dual-sends to
   * Sentry + PostHog.
   */
  @Post('capture/exception')
  captureException(@Query('message') message?: string) {
    const errorMessage = message || 'Test exception from debug endpoint';
    this.logger.log(`Capturing exception: ${errorMessage}`);
    captureException(new Error(errorMessage), {
      tags: { source: 'debug-endpoint', type: 'test-error' },
      extra: {
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
      },
    });
    return {
      success: true,
      message: 'Exception captured',
      sentTo: ['sentry', 'posthog'],
      errorMessage,
    };
  }
}
