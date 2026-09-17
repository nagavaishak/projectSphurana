// @deploy 2026-06-11 — retrigger preview for PR #454
/**
 * NestJS API with Express adapter
 *
 * Environment variables are loaded via env-cmd in the target configuration.
 * See apps/api/package.json for dev/serve targets.
 *
 * @deploy 2026-06-11 — rebuild preview now PR #453 is open
 */
import {
  isTransientDbError,
  testConnection as testDatabaseConnection,
} from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { observabilityEnv } from '@borradh-workspace/env/observability';
import { MetaApiError } from '@borradh-workspace/integrations';
import {
  createRedisFakeStore,
  installMetaContractInterceptor,
} from '@borradh-workspace/integrations/meta-contract';
import {
  NestLogger,
  applyTcpResilienceTuning,
  capturePostHogException,
  createLogger,
  flushLogs,
  flushPostHogOtelExport,
  flush as flushSentry,
  getAppVersion,
  initLogger,
  initPostHog,
  initSentry,
  setupPostHogOtelExport,
  shutdown as shutdownPostHog,
  startPostHogHeartbeat,
  startTelemetryCanary,
} from '@borradh-workspace/observability';
import {
  getBullMqPrefix,
  getRedis,
  testConnection as testRedisConnection,
} from '@borradh-workspace/redis';
import { getS3Client } from '@borradh-workspace/storage';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import helmet from 'helmet';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app/app.module';
import { isKnownWebOrigin } from './common/origins/index.js';
import { isTestFixtureNoise } from './observability/is-test-fixture-noise.js';

declare const module: {
  hot?: {
    accept: () => void;
    dispose: (callback: () => void) => void;
  };
};

// Capture fatal errors that happen outside bootstrap (e.g., top-level import failures)
const fatalLogger = createLogger('Fatal');

/**
 * A dropped Neon/Fly pooled connection surfaces from postgres.js as an ASYNC
 * error fired from a `setImmediate` write callback — outside any query
 * try/catch. The signature is either a transient connection code
 * (`CONNECTION_CLOSED`/`ECONNRESET`/…) or, when the socket is nulled before a
 * queued write fires, a bare `TypeError: Cannot read properties of null
 * (reading 'write')` originating in postgres.js's `connection.js` (`nextWrite`).
 *
 * These are RECOVERABLE: the pool transparently reconnects on the next query and
 * `withDbRetry` covers the query layer. Without this guard a single TCP blip
 * crash-loops the whole API (the global `uncaughtException`/`unhandledRejection`
 * handlers `process.exit(1)`), which is exactly the failure RLS exposed — it
 * runs four pools (`app_system` + the three role pools), so up to 4× the idle
 * connections for Fly's NAT to sever. We log and survive instead of dying.
 */
function isRecoverableDbConnectionError(error: unknown): boolean {
  if (isTransientDbError(error)) return true;
  if (error instanceof Error) {
    const stack = error.stack ?? '';
    const fromPostgresInternals =
      /node_modules[\\/].*postgres[\\/]/.test(stack) &&
      /connection\.js|nextWrite/.test(stack);
    const nullSocketAccess =
      /Cannot read properties of null \(reading '(write|read|readable|writable|once|on|end)'\)/.test(
        error.message
      );
    if (fromPostgresInternals && nullSocketAccess) return true;
  }
  return false;
}

process.on('uncaughtException', async (error) => {
  if (isRecoverableDbConnectionError(error)) {
    // Transient DB connection drop fired from a postgres.js async callback.
    // Surviving is deliberate: the pool reconnects, the query layer retries.
    fatalLogger.warn(
      `Recoverable DB connection error — surviving, pool will reconnect: ${error.message}`,
      { stack: error.stack, name: error.name }
    );
    return;
  }
  fatalLogger.error(`Uncaught exception: ${error.message}`, {
    stack: error.stack,
    name: error.name,
  });
  console.error('[Fatal] Uncaught exception:', error);
  capturePostHogException(error, 'system', { errorType: 'uncaughtException' });
  try {
    await Promise.all([flushLogs(), shutdownPostHog()]);
  } catch {
    /* ignore */
  }
  process.exit(1);
});
process.on('unhandledRejection', async (reason) => {
  if (isRecoverableDbConnectionError(reason)) {
    const message = reason instanceof Error ? reason.message : String(reason);
    fatalLogger.warn(
      `Recoverable DB connection error (unhandled rejection) — surviving: ${message}`,
      { stack: reason instanceof Error ? reason.stack : undefined }
    );
    return;
  }
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  fatalLogger.error(`Unhandled rejection: ${message}`, { stack });
  console.error('[Fatal] Unhandled rejection:', reason);
  const error = reason instanceof Error ? reason : new Error(message);
  capturePostHogException(error, 'system', { errorType: 'unhandledRejection' });
  try {
    await Promise.all([flushLogs(), shutdownPostHog()]);
  } catch {
    /* ignore */
  }
  process.exit(1);
});

// Helper to safely exit after flushing logs
async function exitWithFlush(code: number): Promise<never> {
  try {
    await Promise.race([flushLogs(), new Promise((r) => setTimeout(r, 3000))]);
  } catch {
    /* ignore */
  }
  process.exit(code);
}

async function killPort(port: number): Promise<void> {
  const { execSync } = await import('node:child_process');
  try {
    if (process.platform === 'win32') {
      const out = execSync(
        `netstat -ano | findstr :${port} | findstr LISTENING`,
        { encoding: 'utf8' }
      );
      const pids = new Set(
        out
          .split('\n')
          .map((l) => l.trim().split(/\s+/).pop())
          .filter((p): p is string => !!p && p !== '0')
      );
      for (const pid of pids) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        } catch {
          /* already dead */
        }
        console.log(`[startup] killed stale PID ${pid} on port ${port}`);
      }
    } else {
      execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' });
      console.log(`[startup] killed process on port ${port}`);
    }
  } catch {
    // no process found or kill failed — the retry will surface the real error
  }
}

async function bootstrap() {
  // Use console.log for breadcrumbs - guaranteed to appear in CloudWatch/ECS logs
  console.log('[startup] bootstrap() entered');

  // Tune kernel TCP timeouts FIRST, before any DB/Redis socket is opened, so
  // a Fly-NAT-severed connection is reaped by the OS in ~tens of seconds
  // instead of hanging the pool indefinitely. No-op off Linux; never fatal.
  applyTcpResilienceTuning();

  // Initialize structured logging with Better Stack
  initLogger({
    level: observabilityEnv.LOG_LEVEL,
    logtailToken: observabilityEnv.LOGTAIL_TOKEN,
    logtailEndpoint: observabilityEnv.LOGTAIL_ENDPOINT,
    // APP_ENV is the DEPLOY environment (preview / staging / production);
    // NODE_ENV is the BUILD mode and is 'production' on every Fly deploy,
    // preview included. Reading NODE_ENV here filed every preview's logs
    // under `production`, which both polluted prod dashboards and made a
    // preview's own logs unfindable. `flyApp` (added in logger.ts) already
    // says WHICH preview; this says which environment it belongs to.
    environment: process.env.APP_ENV || process.env.NODE_ENV || 'development',
    serviceName: 'api',
    pretty: process.env.NODE_ENV !== 'production',
  });

  // Initialize Sentry for error tracking (production/staging)
  // Meta conditions that should NOT reach Sentry.
  //
  // `MetaApiError.isExpected` already encodes "driven by the user, the
  // recipient, or Meta's policy — not a fault in our system", so we defer to it
  // rather than keeping a second hand-maintained list. The old local set had
  // drifted from it: it omitted `permission_denied` and `content_error`, which
  // is why a user's Meta permissions (ENG-473, ENG-522) and a user's image
  // aspect ratio (ENG-533) each filed a Linear ticket.
  //
  // `transient` and `rate_limited` are added on top: `isExpected` deliberately
  // excludes them (they can indicate a real problem worth watching) but they
  // are retried, so a single occurrence is not actionable on its own.
  const alsoFiltered = new Set(['transient', 'rate_limited']);

  initSentry({
    dsn: observabilityEnv.SENTRY_DSN,
    environment: observabilityEnv.SENTRY_ENVIRONMENT,
    release: observabilityEnv.SENTRY_RELEASE || getAppVersion(),
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    beforeSend(event, hint) {
      const error = hint?.originalException;

      // Drop MetaApiErrors with known non-actionable categories
      if (
        error instanceof MetaApiError &&
        (error.isExpected || alsoFiltered.has(error.category))
      ) {
        return null;
      }

      // Drop "Invalid password" errors — expected auth failures
      if (error instanceof Error && error.message === 'Invalid password') {
        return null;
      }

      // Drop errors raised by the E2E harness rather than the product. These
      // debut in preview and, because the Linear rule fires on first-seen with
      // no threshold, spend the ticket that the same fingerprint would need
      // when it later appears in production.
      if (
        isTestFixtureNoise({
          error,
          transaction: event.transaction,
          // `_prepareEvent` fills `event.environment` from the client option
          // before `beforeSend` runs; the fallback covers a hand-built event.
          environment: event.environment ?? observabilityEnv.SENTRY_ENVIRONMENT,
        })
      ) {
        return null;
      }

      return event;
    },
  });

  // Initialize PostHog for product analytics
  initPostHog({
    apiKey: observabilityEnv.POSTHOG_API_KEY,
    host: observabilityEnv.POSTHOG_HOST,
  });

  // Attach PostHog OTEL exporter to dual-export HTTP spans from Sentry's tracer
  if (observabilityEnv.POSTHOG_API_KEY) {
    setupPostHogOtelExport(
      observabilityEnv.POSTHOG_API_KEY,
      observabilityEnv.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
    );
  }

  // Dead-man's switch: ping Better Stack only while PostHog telemetry is live,
  // so a silent backend-analytics outage (client up, events not flowing) is
  // alertable instead of rotting unnoticed.
  startPostHogHeartbeat({
    service: 'api',
    heartbeatUrl: observabilityEnv.BETTERSTACK_POSTHOG_HEARTBEAT_URL,
  });

  // Telemetry self-check: emits the same snapshot to Better Stack AND PostHog
  // every minute, so a dead forwarding path is detectable by absence instead of
  // being indistinguishable from "no errors happened".
  startTelemetryCanary({ service: 'api' });

  const logger = new NestLogger('Bootstrap');

  // E2E Meta contract fake / recorder. Installed BEFORE the Nest app is created
  // so no provider can make a Graph call ahead of the interceptor. No-ops (and
  // logs nothing) unless META_E2E_STUB / META_CONTRACT_RECORD is set, so
  // production is untouched.
  // Share the fake's object graph across processes. The preview API runs on TWO
  // machines during the E2E window and the worker is a third; with the default
  // in-memory store a campaign created on one is invisible to the next request,
  // which the suite saw as a list that was empty, then held one, then three
  // duplicates of the same name. Redis is already up for BullMQ.
  //
  // Namespaced by stack, for the same reason BullMQ keys are: every preview
  // shares ONE Redis, so an un-namespaced hash let a concurrent PR's cleanup
  // delete this stack's campaigns and leave its own behind — visible over
  // Graph, but with no `meta_campaign_config` row in THIS stack's database.
  // See `fakeStoreKey` in packages/integrations/.../fake/store.ts.
  const metaContractStore =
    process.env.META_E2E_STUB === 'true'
      ? createRedisFakeStore(getRedis(), { namespace: getBullMqPrefix() })
      : undefined;
  const metaContractMode = installMetaContractInterceptor({
    store: metaContractStore,
  });
  if (metaContractMode) logger.warn(metaContractMode);

  console.log('[startup] creating NestJS application...');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger,
    rawBody: true, // Enable raw body for webhook signature verification
  });
  console.log('[startup] NestJS application created');

  // Behind Fly/ALB the socket peer is the proxy, so without this Express reports
  // the proxy's internal address as `req.ip` and parses `X-Forwarded-For`
  // itself. Trust exactly one proxy hop (the edge that terminates TLS in front
  // of us) so `req.ip`/`req.protocol` reflect the real client for logs and the
  // consent-signature audit trail. Rate limiting does NOT depend on this — the
  // throttler keys on the unspoofable `Fly-Client-IP` header (see
  // FlyThrottlerGuard) — so trusting one hop here can't widen any auth surface.
  app.set('trust proxy', 1);

  // Trigger onModuleDestroy/onApplicationShutdown across all providers when a
  // termination signal arrives. Required so in-process workers (chatbot,
  // knowledge, voice) drain in-flight jobs and scheduler locks release on
  // deploy instead of being severed mid-flight.
  app.enableShutdownHooks();

  // Graceful shutdown - drain the Nest app (fires onModuleDestroy hooks), then
  // flush logs, Sentry, and PostHog events before exit. Guard against a hung
  // close()/flush wedging the process past Fly's/ECS's kill grace period.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`Received ${signal}, shutting down gracefully...`);
    try {
      await Promise.race([
        app.close(),
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]);
    } catch (error) {
      logger.error(
        `Error during app.close(): ${error instanceof Error ? error.message : error}`
      );
    }
    await Promise.all([
      flushLogs(),
      flushSentry(2000),
      shutdownPostHog(),
      flushPostHogOtelExport(),
    ]);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Test database connection
  try {
    console.log('[startup] testing database connection...');
    await testDatabaseConnection();
    console.log('[startup] database connection OK');
  } catch (error) {
    console.error('[startup] DATABASE CONNECTION FAILED:', error);
    logger.error(
      `Database connection failed: ${error instanceof Error ? error.message : error}`
    );
    await exitWithFlush(1);
  }

  // Test Redis connection
  try {
    console.log('[startup] testing Redis connection...');
    await testRedisConnection();
    console.log('[startup] Redis connection OK');
  } catch (error) {
    console.error('[startup] REDIS CONNECTION FAILED:', error);
    logger.error(
      `Redis connection failed: ${error instanceof Error ? error.message : error}`
    );
    await exitWithFlush(1);
  }

  // Pre-initialize S3 client to warm up credentials
  try {
    getS3Client();
    console.log('[startup] S3 client initialized');
  } catch (error) {
    logger.warn(
      `S3 client initialization warning: ${error instanceof Error ? error.message : error}`
    );
    // Don't exit - S3 is not critical for all operations
  }

  // Enable CORS
  // - Frontend apps: specific origins with credentials
  // - V1 API (API key auth): any origin, no credentials needed
  //
  // The allow-list itself lives in `common/origins` because `publicReturnUrl()`
  // needs the same answer when deciding which origins Stripe may redirect a
  // user back to. Two copies of "which origins are ours" is a security bug
  // waiting to drift, not a duplication nit.
  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (health checks, server-to-server, curl)
      // CSRF protection is handled by the CSRF middleware, not CORS
      if (!origin) {
        callback(null, true);
        return;
      }

      // Known frontend origins (with credentials): the static list, Vercel
      // preview deployments under our team, and dev/staging on borradh-dev.com.
      if (isKnownWebOrigin(origin)) {
        callback(null, true);
        return;
      }

      // Reject unknown origins in production.
      //
      // Deny by passing `false` (not an Error). The `cors` package treats a
      // thrown Error as a request failure and propagates it up the middleware
      // chain, where it surfaces as an unhandled 500 and floods Sentry. A
      // plain `false` simply omits the CORS headers so the browser blocks the
      // cross-origin response itself — no server-side error.
      //
      // This also covers the literal `Origin: null` header that sandboxed
      // iframes, privacy modes, and some redirects send: it isn't in the
      // allow-list, so it's denied quietly here instead of throwing.
      if (process.env.NODE_ENV === 'production') {
        callback(null, false);
        return;
      }

      // Allow any origin in non-production for V1 API / development
      callback(null, true);
    },
    credentials: true,
    exposedHeaders: ['X-Conversation-Id'],
  });

  // Security headers (X-Frame-Options, HSTS, X-Content-Type-Options, etc.)
  app.use(helmet());

  // Enable cookie parsing for session tokens
  app.use(cookieParser());

  // Global validation pipe for DTOs (transforms and validates with Zod schemas)
  app.useGlobalPipes(new ZodValidationPipe());

  // Explicit body size limits (Express default is 100kb)
  // CSV import carries a ≤1 MB file inside a JSON string, which can double in
  // size once escaped — give that one route headroom; everything else stays 1mb.
  app.use('/leads/import-csv', json({ limit: '4mb' }));
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });

  const port = apiEnv.PORT;
  console.log(`[startup] listening on port ${port}...`);
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await app.listen(port);
      break;
    } catch (err: unknown) {
      const isAddrInUse =
        err instanceof Error &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
      if (!isAddrInUse || attempt === 5) throw err;
      console.log(
        `[startup] port ${port} busy — killing stale process (attempt ${attempt}/5)...`
      );
      await killPort(port);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // Set server-level timeouts to prevent hung connections
  const server = app.getHttpServer();
  server.setTimeout(120_000); // 120s — kill idle sockets
  server.headersTimeout = 65_000; // 65s — must be > ALB idle timeout (60s)
  server.keepAliveTimeout = 65_000; // 65s — must be > ALB idle timeout (60s)

  console.log(`[startup] API ready at http://localhost:${port}`);
  logger.log(`Application is running on: http://localhost:${port}`);

  // Hot Module Replacement support
  if (module.hot) {
    module.hot.accept();
    module.hot.dispose(() => app.close());
  }
}

bootstrap().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  fatalLogger.error(`Bootstrap failed: ${message}`, { stack });
  console.error('[Bootstrap] Fatal error during startup:', error);
  try {
    await Promise.race([
      Promise.all([flushLogs(), flushSentry(2000), flushPostHogOtelExport()]),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  } catch {
    // ignore flush errors during crash
  }
  process.exit(1);
});

// preview rebuild trigger (ENG-367 ghost commit) — 2026-06-13
