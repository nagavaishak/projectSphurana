import { PostHog } from 'posthog-node';
import type { EventMessage } from 'posthog-node';
import { getCurrentRequestProps } from '../context.js';
import { createLogger } from '../logger.js';
import { isAppCodeStackLine } from './exception-fingerprint.js';
import type {
  PostHogConfig,
  PostHogEventProperties,
  PostHogUserProperties,
} from './types.js';

// Single source of truth for "is PostHog live?": the client reference itself.
// A separate `isInitialized` boolean previously diverged from it across
// duplicate module instances — the AI path checked the client (worked) while
// `trackedResult` checked the boolean (read false), silently dropping every
// backend product event. Keep them collapsed onto one value.
//
/**
 * THE CLIENT LIVES ON `globalThis`, NOT IN MODULE SCOPE.
 *
 * A dual-package hazard only bites state held per module instance: load this
 * file twice and each copy gets its own reference, so whichever copy a caller
 * reached decided whether an event was recorded or dropped. That has now
 * regressed FOUR times — most recently taking production analytics dark for six
 * hours during a live batch, noticed only because someone happened to query for
 * something else.
 *
 * Every previous fix was a DETECTION mechanism: a resolution-discipline test
 * (`package-deps.test.ts`) plus a one-shot warning. Detection keeps losing,
 * because one new import path is all it takes and nothing fails loudly until
 * the telemetry is already gone.
 *
 * A registered symbol makes the bug impossible rather than detectable.
 * `Symbol.for` resolves through the cross-realm registry, so N copies of this
 * module share ONE slot and initialisation from any of them is visible to all.
 * A duplicate instance may still exist; it simply cannot fork this state.
 *
 * The warning below stays — a duplicate instance is still worth knowing about —
 * but it is no longer the only thing between us and silent data loss.
 */
const CLIENT_KEY = Symbol.for('borradh.observability.posthog.client');

const registry = globalThis as unknown as {
  [CLIENT_KEY]?: PostHog | null;
};

const getClient = (): PostHog | null => registry[CLIENT_KEY] ?? null;
const setClient = (next: PostHog | null): void => {
  registry[CLIENT_KEY] = next;
};

// Emit the "not initialized" warning at most once per module instance. If a
// duplicate observability instance ever resurfaces (see package-deps.test.ts),
// the never-initialized copy warns ONCE via the structured logger — loud enough
// to reach Better Stack and alert, without flooding on every dropped event.
let warnedUninitialized = false;

// Tag every event with the deploy environment so staging/preview data stays
// separable from production in the shared PostHog project. `BULLMQ_KEY_PREFIX`
// is `pr-<n>` only on PR-preview backends (unset on prod/staging), so it
// doubles as a per-PR deployment id without polluting the coarse `environment`.
let envProps: Record<string, string> = { environment: 'development' };

const resolveEnvProps = (): Record<string, string> => {
  const deployment = process.env.BULLMQ_KEY_PREFIX?.trim();
  if (deployment) return { environment: 'preview', deployment };
  const environment =
    process.env.APP_ENV ||
    process.env.SENTRY_ENVIRONMENT ||
    (process.env.NODE_ENV === 'production' ? 'production' : 'development');
  return { environment };
};

/**
 * The resolved deploy environment (`development` | `preview` | `production`),
 * computed from the same env vars as event tagging. Unlike {@link getEnvProps},
 * this reads `process.env` directly so callers can decide whether PostHog
 * *should* be live even when initialization was skipped (e.g. the heartbeat).
 */
export const getDeployEnvironment = (): string => resolveEnvProps().environment;

/** A single `$exception_list[].stacktrace.frames[]` entry, loosely typed —
 * posthog-node's own `properties` field is `Record<string, any>`, so this is
 * a best-effort shape for the ONE field we correct. */
interface ExceptionStackFrame {
  filename?: string;
  in_app?: boolean;
  [key: string]: unknown;
}

/**
 * `before_send` hook (ENG-851, cause two): flips `in_app` to `true` for any
 * `$exception` stack frame that belongs to one of OUR workspace packages.
 *
 * posthog-node's own frame parser (`nodeStackLineParser` /
 * `filenameIsInApp` in the installed `@posthog/core`'s
 * `error-tracking/parsers/node.mjs`) sets `in_app = !filename.includes(
 * 'node_modules/')`. In the deployed API bundle, `packages/features` and
 * `packages/observability` resolve on disk under
 * `node_modules/.pnpm/@borradh-workspace+*`, so the SDK marks EVERY frame
 * from our own service/observability code as NOT in-app — only a frame that
 * happens to sit directly under `apps/api/src` (no `node_modules/` in its
 * path) survives the SDK's raw check. Confirmed by installed source; no
 * `before_send`/`in_app` correction ships in `posthog-node@5.17.4` /
 * `@posthog/core@1.8.1` for this case, so it has to happen here.
 *
 * Reuses `isAppCodeStackLine` from `./exception-fingerprint.js` — the SAME
 * "is this app code" rule the fallback-fingerprint helper uses, rather than
 * a second, looser copy. A naive `filename.includes('/packages/')` check
 * would also promote a THIRD-PARTY file that merely happens to live under a
 * `/packages/` segment inside `node_modules/` (e.g. some lib's own
 * `node_modules/some-lib/packages/x.js`); `isAppCodeStackLine` correctly
 * treats any `node_modules/` path as vendor UNLESS it also contains
 * `@borradh-workspace+` (our own packages, resolved through pnpm's on-disk
 * store).
 *
 * Runs on `$exception` events only — every other event type (product
 * analytics, LLM observability, …) passes through untouched. Wrapped so a
 * malformed event (missing/odd-shaped properties) can never throw into the
 * caller; observability must not be able to break the request it's
 * describing.
 */
export const markWorkspaceFramesInApp = (
  event: EventMessage | null
): EventMessage | null => {
  if (!event) return event;
  if (event.event !== '$exception') return event;

  try {
    const exceptionList = (
      event.properties as { $exception_list?: unknown } | undefined
    )?.$exception_list;
    if (!Array.isArray(exceptionList)) return event;

    for (const exception of exceptionList as Array<{
      stacktrace?: { frames?: ExceptionStackFrame[] };
    }>) {
      const frames = exception?.stacktrace?.frames;
      if (!Array.isArray(frames)) continue;

      for (const frame of frames) {
        const filename = frame?.filename;
        if (typeof filename === 'string' && isAppCodeStackLine(filename)) {
          frame.in_app = true;
        }
      }
    }
  } catch (hookError) {
    // Never let a hook bug drop the event or crash the caller — worst case we
    // just miss the in_app correction this run.
    createLogger('PostHog').warn(
      'before_send in_app correction failed, sending event unmodified',
      {
        error:
          hookError instanceof Error ? hookError.message : String(hookError),
      }
    );
  }

  return event;
};

/**
 * Initialize PostHog analytics
 * Call this once at application startup (e.g., in main.ts)
 */
export const initPostHog = (config: PostHogConfig): void => {
  if (getClient()) {
    console.warn('[Observability] PostHog already initialized');
    return;
  }

  if (!config.apiKey) {
    console.warn(
      '[Observability] PostHog API key not provided, skipping initialization'
    );
    return;
  }

  const resolved = resolveEnvProps();
  if (resolved.environment === 'development') {
    console.log('[Observability] PostHog skipped in development');
    return;
  }

  setClient(
    new PostHog(config.apiKey, {
      host: config.host ?? 'https://eu.i.posthog.com',
      flushAt: config.flushAt ?? 20,
      flushInterval: config.flushInterval ?? 10000,
      // ENG-851: correct in_app for our own workspace-package frames on
      // $exception events only. See markWorkspaceFramesInApp for why.
      before_send: markWorkspaceFramesInApp,
    })
  );

  envProps = resolved;
  console.log('[Observability] PostHog initialized');
};

/**
 * Check if PostHog is initialized
 */
export const isPostHogInitialized = (): boolean => getClient() !== null;

/**
 * Get the raw posthog-node client, or `null` when not initialized.
 *
 * Exposed for capture helpers that need to send property shapes the typed
 * {@link trackEvent} doesn't allow (e.g. the array/object `$ai_*` properties
 * of LLM observability events). Prefer the named helpers over this where one
 * exists.
 */
export const getPostHogClient = (): PostHog | null => getClient();

/**
 * The deploy-environment properties stamped onto every captured event
 * (`environment`, and `deployment` on PR previews). Exposed so other capture
 * helpers in this package tag events consistently with {@link trackEvent}.
 */
export const getEnvProps = (): Record<string, string> => envProps;

export interface TrackEventOptions {
  /** PostHog groups to associate this event with, e.g. `{ organization: orgId }`. */
  groups?: Record<string, string>;
  /**
   * When true, do NOT create or update a person profile for this event
   * (`$process_person_profile: false`). The event is anonymous at the person
   * level — use for cron/system/end-customer events with no acting app user so
   * they don't spawn nameless "person" rows keyed on an org/system id.
   */
  personless?: boolean;
  /**
   * Person properties to `$set` on the acting user's profile, carried on this
   * event (no separate `$identify` event). Use to name a user from their own
   * events. Ignored when `personless` is true.
   */
  set?: PostHogUserProperties;
}

/**
 * Track an event in PostHog.
 *
 * Pass `options.personless` for events with no acting user (they won't create a
 * nameless person), `options.groups` to attribute to a group (e.g. organization),
 * and `options.set` to name the acting user from their own event. For the common
 * org-scoped/system case prefer {@link trackOrgEvent}.
 */
export const trackEvent = (
  distinctId: string,
  event: string,
  properties?: PostHogEventProperties,
  options?: TrackEventOptions
): void => {
  const posthog = getClient();
  if (!posthog) {
    // Structured warning (Logtail-forwarded → greppable/alertable in Better
    // Stack). A raw console.log is NOT forwarded, which is why the last outage
    // rotted silently for ~2 weeks. Warn once; subsequent drops stay quiet.
    if (!warnedUninitialized) {
      warnedUninitialized = true;
      createLogger('PostHog').warn(
        'PostHog client not initialized in this module instance — dropping backend events. Likely a duplicate @borradh-workspace/observability instance (see package-deps.test.ts).',
        { firstDroppedEvent: event }
      );
    }
    return;
  }

  const props: Record<string, unknown> = { ...envProps, ...properties };
  if (options?.personless) {
    props.$process_person_profile = false;
  } else if (options?.set) {
    props.$set = options.set;
  }

  posthog.capture({
    distinctId,
    event,
    properties: props,
    ...(options?.groups ? { groups: options.groups } : {}),
  });
};

/**
 * Track an organization-scoped event with NO person profile. The event is
 * attributed to the `organization` group (for org-level rollups) and is
 * anonymous at the person level. Use for cron/system/end-customer (chatbot)
 * events that have no acting app user — instead of keying a "person" on the
 * organization id (which renders as a nameless UUID in PostHog).
 */
export const trackOrgEvent = (
  organizationId: string,
  event: string,
  properties?: PostHogEventProperties
): void => {
  trackEvent(organizationId, event, properties, {
    personless: true,
    groups: { organization: organizationId },
  });
};

/**
 * Capture an exception to PostHog Error Tracking (sends a normalized
 * `$exception` event with stack trace, type and message).
 *
 * Dual-sent from {@link logError} and the Sentry `captureException` wrapper so
 * every backend error reaches PostHog alongside Sentry during the migration.
 * No-op (logs locally) when PostHog isn't initialized, so it's safe to call
 * unconditionally. Do NOT use `trackEvent('$exception', …)` for this — the SDK
 * only normalizes stack traces via `captureException`.
 */
export const capturePostHogException = (
  error: unknown,
  distinctId?: string,
  properties?: Record<string, unknown>
): void => {
  const posthog = getClient();
  if (!posthog) {
    return;
  }

  const err = error instanceof Error ? error : new Error(String(error));
  // Auto-attach request-scoped correlation (request/trace IDs, HTTP
  // method/path, user-agent) from the ambient context so every exception is
  // tied to the request that caused it. Explicit `properties` win on conflict.
  posthog.captureException(err, distinctId ?? 'backend-system', {
    ...envProps,
    ...getCurrentRequestProps(),
    ...properties,
  });
};

/**
 * Identify a user with properties
 */
export const identifyUser = (
  distinctId: string,
  properties?: PostHogUserProperties
): void => {
  const posthog = getClient();
  if (!posthog) {
    console.log(
      `[Observability] PostHog not initialized, logging identify locally: ${distinctId}`,
      properties
    );
    return;
  }

  posthog.identify({
    distinctId,
    properties,
  });
};

/**
 * Associate a user with a group (e.g., organization)
 */
export const setGroup = (
  distinctId: string,
  groupType: string,
  groupKey: string,
  groupProperties?: Record<string, string | number | boolean>
): void => {
  const posthog = getClient();
  if (!posthog) {
    console.log(
      `[Observability] PostHog not initialized, logging group locally: ${groupType}/${groupKey}`
    );
    return;
  }

  posthog.groupIdentify({
    groupType,
    groupKey,
    properties: groupProperties,
  });

  // Also associate the user with this group
  posthog.capture({
    distinctId,
    event: '$groupidentify',
    properties: {
      ...envProps,
      $group_type: groupType,
      $group_key: groupKey,
    },
  });
};

/**
 * Identify (name + set properties on) an `organization` group — WITHOUT any
 * person side-effect.
 *
 * NOTE: posthog-node's `posthog.groupIdentify(...)` emits a `$groupidentify`
 * event keyed on `$<groupType>_<groupKey>` with person processing ON, which
 * mints a `$organization_<id>` **person** for every org. To avoid that, we
 * send the `$groupidentify` event ourselves with `$process_person_profile:
 * false` and `$group_set` for the group properties — this updates the group
 * (the readable name) with no person created.
 *
 * The group key MUST be the database `organization.id` so it matches the
 * `groups: { organization: orgId }` attribution carried on events.
 */
export const identifyOrganization = (
  organizationId: string,
  properties: Record<string, string | number | boolean>
): void => {
  const posthog = getClient();
  if (!posthog) {
    console.log(
      `[Observability] PostHog not initialized, skipping organization identify: ${organizationId}`
    );
    return;
  }

  posthog.capture({
    distinctId: `organization:${organizationId}`,
    event: '$groupidentify',
    properties: {
      ...envProps,
      $group_type: 'organization',
      $group_key: organizationId,
      $group_set: properties,
      // Person-less: do not create a `$organization_<id>` person for the
      // group-identify event.
      $process_person_profile: false,
    },
  });
};

/**
 * Server-side flag-evaluation options. Pass `groups` (e.g.
 * `{ organization: orgId }`) for org-targeted canary flags — without it,
 * group-based release conditions are skipped and the flag reads as `false`.
 */
export interface FeatureFlagOptions {
  groups?: Record<string, string>;
  // posthog-node's flag-evaluation options only accept string property values;
  // stringify numbers/booleans at the call site if a flag condition needs them.
  personProperties?: Record<string, string>;
  groupProperties?: Record<string, Record<string, string>>;
}

/**
 * Check if a feature flag is enabled for a user/org.
 *
 * For canary rollouts gated on `organization`, pass
 * `{ groups: { organization: orgId } }` so the flag's group release conditions
 * are evaluated — otherwise they're skipped and this returns `false`.
 */
export const isFeatureEnabled = async (
  distinctId: string,
  featureKey: string,
  options?: FeatureFlagOptions
): Promise<boolean> => {
  const posthog = getClient();
  if (!posthog) {
    console.log(
      `[Observability] PostHog not initialized, returning false for feature: ${featureKey}`
    );
    return false;
  }

  return (
    (await posthog.isFeatureEnabled(featureKey, distinctId, options)) ?? false
  );
};

/**
 * Get feature flag value (boolean or multivariate string). See
 * {@link isFeatureEnabled} for the `groups` targeting note.
 */
export const getFeatureFlag = async (
  distinctId: string,
  featureKey: string,
  options?: FeatureFlagOptions
): Promise<string | boolean | undefined> => {
  const posthog = getClient();
  if (!posthog) {
    console.log(
      `[Observability] PostHog not initialized, returning undefined for feature: ${featureKey}`
    );
    return undefined;
  }

  return await posthog.getFeatureFlag(featureKey, distinctId, options);
};

/**
 * Flush pending events before shutdown
 */
export const shutdown = async (): Promise<void> => {
  const posthog = getClient();
  if (posthog) {
    await posthog.shutdown();
    setClient(null);
  }
};
