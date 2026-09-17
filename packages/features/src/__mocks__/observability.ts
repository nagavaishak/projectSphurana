/**
 * Canonical mock for `@borradh-workspace/observability`.
 *
 * Aliased in vite.config.ts so the real observability package (Pino + Better
 * Stack + Sentry + PostHog clients) is never loaded in tests, and so every test
 * file sees the *same* mock — a prerequisite for `isolate: false`. See
 * docs/plans/features-test-suite-speedup.md.
 *
 * Test files should NOT `vi.mock('@borradh-workspace/observability')` — import
 * the symbol and drive it with `vi.mocked()`. `beforeEach(vi.clearAllMocks())`
 * (the suite-wide convention) resets call history between tests.
 *
 * The `tracked*` wrappers are PASSTHROUGHS — they invoke the wrapped fn and
 * return its result, matching the long-standing behaviour of the previous
 * global `test-setup.ts` mock. Keeping these semantics identical means no
 * service test changes behaviour when the real module is swapped for this one.
 */
import { vi } from 'vitest';

// --- tracked() family: passthrough so the wrapped impl actually runs ---
export const tracked = vi.fn((_name: string, fn: () => Promise<unknown>) =>
  fn()
);
export const trackedSafe = vi.fn((_name: string, fn: () => Promise<unknown>) =>
  fn()
);
export const trackedResult = vi.fn(
  (_name: string, fn: () => Promise<unknown>) => fn()
);

// --- Sentry surface ---
export const logError = vi.fn();
export const logWarning = vi.fn();
export const captureException = vi.fn();
export const captureMessage = vi.fn();
export const addBreadcrumb = vi.fn();
export const setUser = vi.fn();
export const flush = vi.fn().mockResolvedValue(true);
export const initSentry = vi.fn();
export const isSentryInitialized = vi.fn(() => false);

// --- PostHog surface ---
export const trackEvent = vi.fn();
export const captureAiGeneration = vi.fn();
export const captureAiEmbedding = vi.fn();
export const trackOrgEvent = vi.fn();
export const identifyUser = vi.fn();
export const setGroup = vi.fn();
export const identifyOrganization = vi.fn();
export const isFeatureEnabled = vi.fn(() => false);
export const getFeatureFlag = vi.fn(() => undefined);
export const initPostHog = vi.fn();
export const isPostHogInitialized = vi.fn(() => false);
export const shutdown = vi.fn().mockResolvedValue(undefined);

// --- Logger surface ---
type MockLogger = {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  child: ReturnType<typeof vi.fn>;
};
const makeMockLogger = (): MockLogger => {
  const logger: MockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => makeMockLogger()),
  };
  return logger;
};

// Memoised per name. Services call `createLogger('x')` once at module scope, so
// without this a test has no handle on the instance its subject is logging to
// (`beforeEach(vi.clearAllMocks())` wipes `createLogger.mock.results`, and under
// `isolate: false` other files' loggers are interleaved in it anyway). Same
// name -> same logger also matches the real module, where a name identifies a
// logger rather than minting a new one. Use `getMockLogger(name)` to assert.
const loggersByName = new Map<string, MockLogger>();
export const createLogger = vi.fn((name?: string) => {
  const key = name ?? '__unnamed__';
  const existing = loggersByName.get(key);
  if (existing) return existing;
  const logger = makeMockLogger();
  loggersByName.set(key, logger);
  return logger;
});

/** Test helper: the logger a service under test received for `createLogger(name)`. */
export const getMockLogger = (name: string): MockLogger => {
  const existing = loggersByName.get(name);
  if (existing) return existing;
  const logger = makeMockLogger();
  loggersByName.set(name, logger);
  return logger;
};
export const initLogger = vi.fn();
export const getLogger = vi.fn(() => makeMockLogger());
export const flushLogs = vi.fn().mockResolvedValue(undefined);
export const NestLogger = vi.fn();
export const createNestLogger = vi.fn();

// --- Deploy environment ---
// Defaults to 'production' so severity-sensitive code under test takes the
// strict path unless a test opts out (`vi.mocked(getDeployEnvironment)
// .mockReturnValue('preview')`). The real helper reads process.env directly.
export const getDeployEnvironment = vi.fn(() => 'production');

// --- Misc utilities ---
export const redactPII = vi.fn(
  (input: string | null | undefined) => input ?? ''
);
export const applyTcpResilienceTuning = vi.fn();

// --- Observability context (ALS) ---
export const getObservabilityContext = vi.fn(() => undefined);
export const getCurrentUserId = vi.fn(() => 'anonymous');
export const getCurrentUserSetProps = vi.fn(() => ({}));
export const setContextUserId = vi.fn();
export const setContextUser = vi.fn();
export const runWithContext = vi.fn((_ctx: unknown, fn: () => unknown) => fn());
export const withObservabilityContext = vi.fn(
  (_ctx: unknown, fn: () => unknown) => fn()
);

// --- Feature-flag surface (mirrors @borradh-workspace/observability flags) ---
export interface FlagContext {
  unitId?: string;
  groups?: Record<string, string>;
  properties?: Record<string, string>;
}

export interface FlagProvider {
  getFlag(
    key: string,
    context?: FlagContext
  ): boolean | undefined | Promise<boolean | undefined>;
}

export const staticProvider = (
  map: Record<string, boolean> = {}
): FlagProvider => ({
  getFlag(key: string): boolean | undefined {
    return Object.prototype.hasOwnProperty.call(map, key)
      ? map[key]
      : undefined;
  },
});

export const withFlags = (map: Record<string, boolean> = {}): FlagProvider =>
  staticProvider(map);

export const allFlagsOff = (): FlagProvider => staticProvider({});

export const allFlagsOn = (...keys: string[]): FlagProvider =>
  staticProvider(Object.fromEntries(keys.map((k) => [k, true])));

export const resolveFlag = vi.fn(
  async (
    provider: FlagProvider,
    key: string,
    context?: FlagContext,
    options?: { defaultEnabled?: boolean }
  ): Promise<boolean> => {
    const fallback = options?.defaultEnabled ?? false;
    try {
      const state = await provider.getFlag(key, context);
      return typeof state === 'boolean' ? state : fallback;
    } catch {
      return fallback;
    }
  }
);

// `isFeatureOn` defaults to OFF when no provider is passed, matching production's
// safe default. Tests that exercise the flag-ON path pass a provider explicitly
// (e.g. `withFlags({ myFlag: true })`), or drive it via `vi.mocked(isFeatureOn)`.
// `beforeEach(vi.clearAllMocks())` resets call history between tests.
export const isFeatureOn = vi.fn(
  async (
    key: string,
    options: {
      defaultEnabled?: boolean;
      provider?: FlagProvider;
      unitId?: string;
    } = {}
  ): Promise<boolean> => {
    const fallback = options.defaultEnabled ?? false;
    if (!options.provider) return fallback;
    const state = await options.provider.getFlag(key, {
      unitId: options.unitId,
    });
    return typeof state === 'boolean' ? state : fallback;
  }
);

export const isInRollout = vi.fn(() => false);
export const rolloutBucket = vi.fn(() => 0);
export const resolveKillSwitch = vi.fn(() => ({ active: false }));
export const postHogFlagProvider = vi.fn(() => staticProvider({}));
