import { defineCoverage } from '../coverage.types.js';

/**
 * DEBUG — 12 endpoints, 0 tools. A controller whose entire purpose is to
 * MISBEHAVE ON PURPOSE, so that the observability pipeline can be proven to
 * catch each way of misbehaving.
 *
 * Eight of these routes exist only to throw. They are how we verified that a
 * rejected promise reaches Sentry, that a Postgres error surfaces its code
 * from `err.cause`, that `trackedResult` failures land in PostHog, and that
 * the Pino-to-BetterStack path is actually wired — the last of which was dark
 * for two releases because a worker-thread transport failed silently.
 *
 * Nothing here reads or writes business data, so withholding costs Claire no
 * capability. What it buys is signal integrity: alert thresholds and error
 * budgets are set against these streams, and an agent able to inject errors on
 * request would make every production error rate unreadable. The rule that
 * fake incidents stop real ones from being believed applies here literally.
 */
export const debugCoverage = defineCoverage('debug', {
  'GET /debug/error/unhandled': {
    notExposed:
      'Throws synchronously from the handler to prove the Nest exception filter reports to Sentry. Injecting these on request would pollute the error rate that on-call alerting is calibrated against.',
  },
  'GET /debug/error/async': {
    notExposed:
      'Rejects a promise outside the request cycle, verifying unhandled rejections are captured rather than swallowed. Deliberate breakage, invoked by an engineer checking a pipeline.',
  },
  'GET /debug/error/http': {
    notExposed:
      'Raises a typed HttpException so the mapping from error code to status can be observed end to end. Its only output is a deliberate failure response.',
  },
  'GET /debug/error/type': {
    notExposed:
      'Triggers a genuine TypeError to confirm stack frames survive the build’s source maps. Useful to a release engineer, meaningless to a business owner.',
  },
  'GET /debug/error/db-cause': {
    notExposed:
      'Provokes a Postgres failure specifically to check that the driver’s error code is read from err.cause, which is where Drizzle nests it and where triage kept missing it.',
  },
  'GET /debug/error/log-error': {
    notExposed:
      'Exercises logError so the Pino-to-BetterStack path can be confirmed live. This one exists because that transport failed silently in the pnpm monorepo and nobody noticed for two releases.',
  },
  'GET /debug/error/log-warning': {
    notExposed:
      'Exercises logWarning so the warning path can be confirmed live in BOTH sinks. It exists because logWarning was Sentry-only for two months — PostHog held nothing warning-shaped — and only a diff against Sentry revealed it. Same reasoning as log-error: an agent able to inject warnings on request would make the warning rate unreadable.',
  },
  'GET /debug/error/tracked': {
    notExposed:
      'Fires an error through the tracked wrapper to verify Sentry breadcrumbs and PostHog exception events both appear. Emits telemetry, not information.',
  },
  'GET /debug/error/tracked-result': {
    notExposed:
      'Returns a failed Result through trackedResult, checking the failure-event path that differs from the thrown-exception path. Purely an observability assertion.',
  },
  'POST /debug/capture/exception': {
    notExposed:
      'Sends an arbitrary caller-supplied exception straight to Sentry. An agent with a direct write into the error stream could bury a real incident under noise it invented.',
  },
  'POST /debug/capture/message': {
    notExposed:
      'Same direct injection for a log message at a chosen level. It writes into the record engineers rely on to reconstruct what actually happened.',
  },
  'GET /debug/health': {
    notExposed:
      'Confirms the debug controller is mounted on this deployment. The real liveness and readiness answers live under /health, and neither is a question an owner asks Claire.',
  },
});
