/**
 * Dual-send bridge: forwards Sentry events to BetterStack Errors during the
 * migration parallel-run. BetterStack Errors ingests via the Sentry wire
 * protocol, so we POST the same event JSON to BetterStack's store endpoint.
 *
 * Fire-and-forget: never throws, never blocks, never retries. If BetterStack
 * is down it's silently dropped — Sentry is still the source of truth until
 * we flip the DSN for real.
 *
 * Enable by setting one of:
 *   - BETTERSTACK_ERROR_DSN              (server: API, video-worker, Next SSR)
 *   - NEXT_PUBLIC_BETTERSTACK_ERROR_DSN  (browser: Next.js client)
 *   - EXPO_PUBLIC_BETTERSTACK_ERROR_DSN  (React Native)
 */

interface ParsedDsn {
  publicKey: string;
  host: string;
  projectId: string;
}

const parseDsn = (dsn: string): ParsedDsn | null => {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!url.username || !projectId) return null;
    return {
      publicKey: url.username,
      host: `${url.protocol}//${url.host}`,
      projectId,
    };
  } catch {
    return null;
  }
};

const readRawDsn = (): string | undefined => {
  // In browsers/React Native, process.env is inlined at build time; a missing
  // key is `undefined`, which is fine. Guard process itself for edge runtimes.
  if (typeof process === 'undefined' || !process.env) return undefined;
  return (
    process.env.BETTERSTACK_ERROR_DSN ||
    process.env.NEXT_PUBLIC_BETTERSTACK_ERROR_DSN ||
    process.env.EXPO_PUBLIC_BETTERSTACK_ERROR_DSN ||
    undefined
  );
};

let cached: ParsedDsn | null | undefined;

const getDsn = (): ParsedDsn | null => {
  if (cached !== undefined) return cached;
  const raw = readRawDsn();
  cached = raw ? parseDsn(raw) : null;
  return cached;
};

/**
 * Resolve the deploy environment for a synthesized event.
 *
 * Deliberately duplicated from `posthog/client.ts`'s `resolveEnvProps` rather
 * than imported: that module imports `posthog-node`, and this file must stay
 * dependency-free so it can run in a browser / React Native bundle. The
 * precedence must stay in step with it — an environment mismatch would file
 * production errors under the wrong environment in BetterStack.
 */
const resolveEnvironment = (): string => {
  if (typeof process === 'undefined' || !process.env) return 'development';
  if (process.env.BULLMQ_KEY_PREFIX?.trim()) return 'preview';
  return (
    process.env.APP_ENV ||
    process.env.SENTRY_ENVIRONMENT ||
    (process.env.NODE_ENV === 'production' ? 'production' : 'development')
  );
};

const resolveRelease = (): string | undefined => {
  if (typeof process === 'undefined' || !process.env) return undefined;
  return process.env.SENTRY_RELEASE || process.env.APP_VERSION || undefined;
};

/** 32 lowercase hex chars, no dashes — what the Sentry protocol requires. */
const newEventId = (): string => {
  const raw =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : Array.from({ length: 4 }, () =>
          Math.random().toString(16).slice(2, 10)
        ).join('');
  return raw.padEnd(32, '0').slice(0, 32);
};

export interface BetterStackErrorContext {
  level?: 'error' | 'warning';
  operation?: string;
  feature?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id?: string; email?: string };
}

/**
 * Forward an Error to BetterStack WITHOUT Sentry being involved.
 *
 * WHY THIS EXISTS: BetterStack Errors was fed exclusively from Sentry's
 * `beforeSend` hook, which made it a silent hostage — turning Sentry off, or
 * simply deploying without a DSN, stopped BetterStack ingestion too, and
 * nothing failed loudly to say so. Since the plan is to demote Sentry, the two
 * had to become separable.
 *
 * This synthesizes the minimal Sentry-protocol event BetterStack needs. It is
 * NOT full parity with a real Sentry event: no parsed stack frames (the raw
 * stack goes in `extra.stack`, and BetterStack groups on exception type + value
 * regardless), no breadcrumbs, no request context. That is the accepted cost of
 * not depending on the Sentry SDK to build the payload, and it applies only on
 * this fallback path — the richer `beforeSend` bridge still runs whenever Sentry
 * IS initialized, so today's behaviour is unchanged.
 */
export const forwardErrorToBetterStack = (
  error: Error,
  context?: BetterStackErrorContext
): void => {
  const cause = error.cause instanceof Error ? error.cause : undefined;
  const root = cause ?? error;

  forwardEventToBetterStack({
    event_id: newEventId(),
    timestamp: new Date().toISOString(),
    // Probed via globalThis rather than naming `window`: this package compiles
    // with `types: ["node"]` and no DOM lib, but the file still runs in browser
    // and React Native bundles.
    platform:
      (globalThis as { window?: unknown }).window === undefined
        ? 'node'
        : 'javascript',
    level: context?.level ?? 'error',
    logger: context?.operation,
    environment: resolveEnvironment(),
    release: resolveRelease(),
    // Report the root cause as the exception, matching how logError reports to
    // Sentry and PostHog — so all three group on the same underlying error.
    exception: { values: [{ type: root.name, value: root.message }] },
    tags: {
      ...(context?.feature ? { feature: context.feature } : {}),
      ...(context?.operation ? { operation: context.operation } : {}),
      ...context?.tags,
    },
    extra: {
      stack: root.stack,
      ...(cause ? { wrappedBy: error.message } : {}),
      ...context?.extra,
    },
    user: context?.user,
  });
};

/**
 * Forward a Sentry event to BetterStack. Safe to call from any `beforeSend`
 * hook — it never throws and returns immediately. Does nothing if no
 * BetterStack DSN is configured.
 */
export const forwardEventToBetterStack = (event: unknown): void => {
  const dsn = getDsn();
  if (!dsn) return;
  if (typeof fetch === 'undefined') return;

  const url = `${dsn.host}/api/${dsn.projectId}/store/`;
  const auth = `Sentry sentry_version=7,sentry_client=borradh-forwarder/1.0,sentry_key=${dsn.publicKey}`;

  try {
    void fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': auth,
      },
      body: JSON.stringify(event),
    }).catch(() => {
      /* swallow — fire and forget */
    });
  } catch {
    /* swallow */
  }
};
