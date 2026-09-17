import { Logtail } from '@logtail/node';
import pino, { type Logger as PinoLogger, type LoggerOptions } from 'pino';
import { getAppVersion } from './app-version.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LoggerConfig {
  level?: LogLevel;
  logtailToken?: string;
  /**
   * Better Stack ingesting host for the Logtail client, e.g.
   * `https://s2623988.eu-central-1a.betterstackdata.com`. Optional — when
   * unset, @logtail/node uses its default endpoint (in.logs.betterstack.com).
   * A source token is only accepted by ITS OWN ingesting host: newer sources
   * (different data regions) 401 on the default endpoint, so the preview API
   * source must set this to its host. Prod's source token works on the
   * default, so prod leaves this unset.
   */
  logtailEndpoint?: string;
  environment?: string;
  serviceName?: string;
  pretty?: boolean;
  /** Version/release for tracking deployments */
  version?: string;
  /** Hostname override (useful for containers) */
  hostname?: string;
}

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  fatal(message: string, context?: LogContext): void;
  child(bindings: LogContext): Logger;
}

let rootLogger: PinoLogger | null = null;
let logtailClient: Logtail | null = null;
let baseContext: Record<string, unknown> = {};

/**
 * True once {@link initLogger} has been called explicitly by an app entrypoint.
 *
 * `getLogger()` lazily calls `initLogger()` with NO config when this is false,
 * which yields a logger with `logtailClient === null` — pino still writes to
 * stdout, so the process looks perfectly healthy while EVERY log silently never
 * reaches Better Stack, forever. `initObservability()` wires Sentry + PostHog
 * but not the logger, so that combination is easy to hit by accident. The
 * telemetry canary reports this flag so the condition is visible instead of
 * presenting as "quiet".
 */
let loggerExplicitlyInitialized = false;

/** Logs dropped locally in sendToLogtail (redaction/serialisation failures). */
let localDropCount = 0;

/**
 * Initialize the logger with Better Stack (Logtail) integration.
 * Call this once at application startup.
 *
 * Uses @logtail/node directly in the main thread instead of @logtail/pino transport.
 * Pino transports run in worker threads, and pnpm's strict isolation prevents
 * the worker from resolving @logtail/pino's dependencies, causing silent failures.
 */
export const initLogger = (config: LoggerConfig = {}): Logger => {
  const {
    level = 'info',
    logtailToken,
    logtailEndpoint,
    environment = process.env.NODE_ENV || 'development',
    serviceName = 'api',
    pretty = process.env.NODE_ENV !== 'production',
    version = getAppVersion(),
    hostname = process.env.HOSTNAME,
  } = config;

  baseContext = {
    env: environment,
    service: serviceName,
    version,
    ...(hostname && { host: hostname }),
    // Fly source-identity tags. Preview APIs (borradh-api-pr-639, -642, …) all
    // ship to one shared BetterStack source, so without these you can't tell
    // which preview a log came from. flyApp is the human-readable app name
    // (the primary "which preview" tag); flyMachine is the Fly machine id.
    // Conditional on the env var so local/non-Fly runs are unaffected; prod on
    // Fly gets tagged too (useful, harmless). baseContext feeds both pino's
    // stdout `base` and the sendToLogtail BetterStack payload, so this one
    // change tags every event in both places.
    ...(process.env.FLY_APP_NAME && { flyApp: process.env.FLY_APP_NAME }),
    ...(process.env.FLY_MACHINE_ID && {
      flyMachine: process.env.FLY_MACHINE_ID,
    }),
  };

  const baseOptions: LoggerOptions = {
    level,
    base: baseContext,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    // Redact sensitive fields
    redact: {
      paths: [
        'password',
        'token',
        'sessionToken',
        'accessToken',
        'refreshToken',
        'idToken',
        'authorization',
        'cookie',
        'apiKey',
        'api_key',
        'secret',
        'clientSecret',
        'privateKey',
        'encryptionKey',
        'connectionString',
        'DATABASE_URL',
        '*.password',
        '*.token',
        '*.sessionToken',
        '*.accessToken',
        '*.refreshToken',
        '*.idToken',
        '*.apiKey',
        '*.api_key',
        '*.secret',
        '*.clientSecret',
        '*.privateKey',
        '*.encryptionKey',
        '*.connectionString',
      ],
      censor: '[REDACTED]',
    },
  };

  // Build transport targets for console output only
  const targets: pino.TransportTargetOptions[] = [];

  // Pretty print for development
  if (pretty) {
    targets.push({
      target: 'pino-pretty',
      level,
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
        messageFormat: '{if context}[{context}] {end}{msg}',
      },
    });
  } else {
    // JSON output for production (stdout)
    targets.push({
      target: 'pino/file',
      level,
      options: { destination: 1 }, // stdout
    });
  }

  // Create transport (console only — Logtail is handled separately below)
  const transport = pino.transport({ targets });
  rootLogger = pino(baseOptions, transport);

  // Initialize Logtail client directly (main thread, no worker thread issues)
  if (logtailToken) {
    logtailClient = new Logtail(logtailToken, {
      batchSize: 10,
      batchInterval: 1000,
      // Route to the source's own ingesting host when provided. Required for
      // sources whose token is rejected by the default endpoint (see
      // LoggerConfig.logtailEndpoint). Omitted → @logtail/node default.
      ...(logtailEndpoint && { endpoint: logtailEndpoint }),
    });
  } else {
    logtailClient = null;
  }

  loggerExplicitlyInitialized = true;
  localDropCount = 0;

  // eslint-disable-next-line no-console
  console.log(
    `[Logger] Initialized: level=${level}, logtail=${!!logtailClient}, pretty=${pretty}`
  );

  return wrapLogger(rootLogger, {});
};

/**
 * Get the root logger instance.
 * Throws if logger hasn't been initialized.
 */
export const getLogger = (): Logger => {
  if (!rootLogger) {
    return initLogger();
  }
  return wrapLogger(rootLogger, {});
};

/**
 * Create a child logger with additional context bindings.
 * Useful for adding request-specific or feature-specific context.
 */
export const createLogger = (
  context: string,
  bindings: LogContext = {}
): Logger => {
  const base = rootLogger || pino({ level: 'info' });
  return wrapLogger(base.child({ context, ...bindings }), {
    context,
    ...bindings,
  });
};

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'sessionToken',
  'accessToken',
  'refreshToken',
  'idToken',
  'authorization',
  'cookie',
  'apiKey',
  'api_key',
  'secret',
  'clientSecret',
  'privateKey',
  'encryptionKey',
  'connectionString',
  'DATABASE_URL',
]);

const CENSOR = '[REDACTED]';

/**
 * Redact sensitive fields from an object before sending to Logtail.
 * Pino's built-in redaction only applies to Pino's serialization pipeline,
 * not to the parallel Logtail send path.
 */
const MAX_REDACT_DEPTH = 12;

const redactObject = (
  obj: Record<string, unknown>,
  depth = 0,
  seen: WeakSet<object> = new WeakSet()
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key)) {
      result[key] = CENSOR;
    } else if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      // Depth + cycle guards. Without them a circular or pathologically deep
      // `extra` payload throws RangeError out of sendToLogtail — synchronously,
      // from inside logger.error() — which aborts the CALLER mid-flight (in
      // logError that means the PostHog capture below it never runs). Truncate
      // instead: a partial log beats an exception thrown by the log call.
      if (depth >= MAX_REDACT_DEPTH) {
        result[key] = '[TRUNCATED: max depth]';
      } else if (seen.has(value as object)) {
        result[key] = '[CIRCULAR]';
      } else {
        seen.add(value as object);
        result[key] = redactObject(
          value as Record<string, unknown>,
          depth + 1,
          seen
        );
      }
    } else {
      result[key] = value;
    }
  }
  return result;
};

/**
 * Forward one log line to Better Stack.
 *
 * NOTE on error handling: `@logtail/core`'s `log()` does NOT reject on a send
 * failure. It catches internally and — with the default `ignoreExceptions:false`
 * + `throwExceptions:false` — reports via `console.error` and resolves normally
 * (`@logtail/core/dist/cjs/base.js`, the `catch` around `await this._batch(...)`).
 * A `.catch()` here is therefore dead code, and every dropped log is recorded
 * ONLY in the client's internal `dropped` counter plus a raw `console.error`
 * that is not itself forwarded to Better Stack. That is precisely why a dead
 * forwarding path presents as "quiet" rather than "broken".
 *
 * We keep the promise rejection handler for safety, but liveness is measured by
 * polling {@link getTelemetryStats} — see the telemetry canary.
 */
const sendToLogtail = (
  level: string,
  message: string,
  bindings: LogContext,
  context?: LogContext
) => {
  if (!logtailClient) return;

  try {
    const meta = redactObject({
      ...baseContext,
      ...bindings,
      ...context,
      dt: new Date(),
    });

    void logtailClient.log(message, level, meta).catch(() => {
      // Unreachable with the SDK defaults above; counted for completeness.
      localDropCount += 1;
    });
  } catch {
    // Redaction/serialisation blew up. Never let a logging call throw into its
    // caller — that turns an error-reporting path into a second failure.
    localDropCount += 1;
  }
};

export interface TelemetryStats {
  /** True once an app entrypoint called initLogger() explicitly. */
  loggerExplicitlyInitialized: boolean;
  /** True when a Logtail token was supplied, i.e. Better Stack is wired. */
  logtailConfigured: boolean;
  /** Logs accepted by the Logtail client since process start. */
  logged: number;
  /** Logs successfully synced to Better Stack. */
  synced: number;
  /** Logs the Logtail client dropped (batch/sync failures). */
  dropped: number;
  /** Logs dropped locally before reaching the client (redaction failures). */
  localDropped: number;
}

/**
 * Snapshot of the log-forwarding pipeline's own health.
 *
 * `logged - synced - dropped` is the in-flight backlog; a persistently growing
 * `dropped` means Better Stack is losing lines even though the app looks fine.
 */
export const getTelemetryStats = (): TelemetryStats => ({
  loggerExplicitlyInitialized,
  logtailConfigured: logtailClient !== null,
  logged: logtailClient?.logged ?? 0,
  synced: logtailClient?.synced ?? 0,
  dropped: logtailClient?.dropped ?? 0,
  localDropped: localDropCount,
});

/**
 * Wrap Pino logger to provide a cleaner interface.
 * Also forwards every log to Logtail in the main thread.
 */
const wrapLogger = (pinoLogger: PinoLogger, bindings: LogContext): Logger => ({
  debug: (message: string, context?: LogContext) => {
    if (context) {
      pinoLogger.debug(context, message);
    } else {
      pinoLogger.debug(message);
    }
    sendToLogtail('debug', message, bindings, context);
  },
  info: (message: string, context?: LogContext) => {
    if (context) {
      pinoLogger.info(context, message);
    } else {
      pinoLogger.info(message);
    }
    sendToLogtail('info', message, bindings, context);
  },
  warn: (message: string, context?: LogContext) => {
    if (context) {
      pinoLogger.warn(context, message);
    } else {
      pinoLogger.warn(message);
    }
    sendToLogtail('warn', message, bindings, context);
  },
  error: (message: string, context?: LogContext) => {
    if (context) {
      pinoLogger.error(context, message);
    } else {
      pinoLogger.error(message);
    }
    sendToLogtail('error', message, bindings, context);
  },
  fatal: (message: string, context?: LogContext) => {
    if (context) {
      pinoLogger.fatal(context, message);
    } else {
      pinoLogger.fatal(message);
    }
    sendToLogtail('fatal', message, bindings, context);
  },
  child: (childBindings: LogContext) =>
    wrapLogger(pinoLogger.child(childBindings), {
      ...bindings,
      ...childBindings,
    }),
});

/**
 * Flush logs before process exit.
 * Call this in graceful shutdown handlers.
 */
export const flushLogs = async (): Promise<void> => {
  const promises: Promise<void>[] = [];

  if (rootLogger) {
    promises.push(
      new Promise<void>((resolve) => {
        rootLogger?.flush(() => resolve());
      })
    );
  }

  if (logtailClient) {
    promises.push(logtailClient.flush().then(() => undefined));
  }

  await Promise.all(promises);
};
