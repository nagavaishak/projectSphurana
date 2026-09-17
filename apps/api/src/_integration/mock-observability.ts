/**
 * Partial-mock observability for the integration harness: keep the REAL module
 * but no-op logError/logWarning. Their lazy pino/logtail + PostHog error path
 * does a dynamic `import()` jest's VM can't run without
 * --experimental-vm-modules, so a fire-and-forget error log (e.g. a
 * notification whose Redis enqueue fails in the harness) becomes an unhandled
 * rejection that fails the test. Everything else (trackedResult, flags,
 * context, createLogger) stays real.
 */
jest.mock('@borradh-workspace/observability', () => {
  const actual = jest.requireActual('@borradh-workspace/observability');
  return { ...actual, logError: () => {}, logWarning: () => {} };
});
