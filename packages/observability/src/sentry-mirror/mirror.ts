import { observabilityEnv } from '@borradh-workspace/env/observability';
import { getLogger } from '../logger.js';
import {
  capturePostHogException,
  getDeployEnvironment,
} from '../posthog/client.js';
import {
  type SentryApiEvent,
  isNativeOriginEvent,
  sentryEventId,
  toPostHogException,
} from './native-event.js';

/**
 * Mirror native crashes and ANRs from Sentry into PostHog.
 *
 * WHY A POLL AND NOT A WEBHOOK. Three reasons, in order of weight:
 *
 *  1. A webhook would need configuring in Sentry's dashboard by hand, so the
 *     pipeline could be silently un-configured by someone else later with no
 *     signal here. A poll is self-contained: it works as soon as
 *     SENTRY_AUTH_TOKEN is set, and its absence is loggable.
 *  2. This is not a webhook, so it should not join `webhookProviders` and the
 *     webhook-event registry — that registry demands declared event types and a
 *     subscription disposition per type, which models a customer-data
 *     subscription, not a crash mirror.
 *  3. Latency is irrelevant. A native crash reaches Sentry on the device's NEXT
 *     LAUNCH, which is already minutes-to-days after the fact. Polling adds
 *     nothing measurable to that.
 *
 * IDEMPOTENCY. The window deliberately OVERLAPS the interval, so a late-arriving
 * event or a skipped run cannot open a permanent hole. Overlap means the same
 * event is seen repeatedly, so every event is claimed exactly once through
 * `claimEvent` before being forwarded. Without that claim, overlap would
 * duplicate every crash on every run — which is worse than the gap it fixes.
 */

const SENTRY_API = 'https://sentry.io/api/0';

export interface MirrorDeps {
  /**
   * Claim an event id for forwarding. MUST be atomic and MUST return false for
   * an id already claimed — that is the only thing standing between the
   * overlapping window and duplicate crashes in PostHog. Redis `SET NX` in the
   * API/worker; a Set in tests.
   */
  claimEvent: (eventId: string) => Promise<boolean>;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface MirrorResult {
  scanned: number;
  native: number;
  forwarded: number;
  skippedAlreadyClaimed: number;
  skipped: 'no-token' | 'not-production' | null;
}

/**
 * Pull recent events for the mobile project and forward the native-origin ones.
 *
 * Never throws: this runs on a schedule beside real work, and a Sentry API
 * hiccup must not take a scheduler tick down with it.
 */
export const mirrorSentryNativeEvents = async (
  deps: MirrorDeps,
  options: { lookbackMinutes?: number } = {}
): Promise<MirrorResult> => {
  const logger = getLogger();
  const empty: MirrorResult = {
    scanned: 0,
    native: 0,
    forwarded: 0,
    skippedAlreadyClaimed: 0,
    skipped: null,
  };

  // EXACTLY ONE deploy environment may mirror, and it must be production.
  //
  // There is one Sentry project holding one population of native crashes, but
  // the claim store is Redis and every environment has its OWN Redis. So
  // without this gate the prod API, staging, and EVERY PR-preview app would each
  // independently claim and forward the same production crash — multiplying
  // every crash in PostHog by the number of live environments, and all of them
  // tagged `production` because the environment comes from Sentry's own tag.
  //
  // The claim cannot fix this: claims are only shared within an environment.
  // Single-owner is the only correct rule, and production is the owner because
  // that is whose crashes these are.
  const deployEnvironment = getDeployEnvironment();
  if (deployEnvironment !== 'production') {
    logger.debug('sentry-mirror skipped: not the production environment', {
      deployEnvironment,
    });
    return { ...empty, skipped: 'not-production' };
  }

  const token = observabilityEnv.SENTRY_AUTH_TOKEN;
  if (!token) {
    // Not an error: only the production API configures this. Logged at debug so
    // it does not cry wolf in every local run.
    logger.debug('sentry-mirror skipped: SENTRY_AUTH_TOKEN not set');
    return { ...empty, skipped: 'no-token' };
  }

  const doFetch = deps.fetchImpl ?? fetch;
  const now = (deps.now ?? (() => new Date()))();
  const lookbackMinutes = options.lookbackMinutes ?? 120;
  const since = new Date(now.getTime() - lookbackMinutes * 60_000);

  const org = observabilityEnv.SENTRY_ORG;
  const project = observabilityEnv.SENTRY_MOBILE_PROJECT;
  const url =
    `${SENTRY_API}/projects/${org}/${project}/events/` +
    `?start=${encodeURIComponent(since.toISOString())}` +
    `&end=${encodeURIComponent(now.toISOString())}`;

  let events: SentryApiEvent[];
  try {
    const response = await doFetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      logger.error('sentry-mirror: Sentry API rejected the request', {
        status: response.status,
      });
      return empty;
    }
    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) {
      logger.error('sentry-mirror: unexpected Sentry API payload shape');
      return empty;
    }
    events = body as SentryApiEvent[];
  } catch (error) {
    logger.error('sentry-mirror: failed to read from Sentry', {
      errorName: error instanceof Error ? error.name : 'unknown',
      stack: error instanceof Error ? error.stack : undefined,
    });
    return empty;
  }

  const result: MirrorResult = { ...empty, scanned: events.length };

  for (const event of events) {
    if (!isNativeOriginEvent(event)) continue;
    result.native += 1;

    const id = sentryEventId(event);
    if (!id) {
      // Cannot be claimed, so cannot be forwarded exactly once. Skipping is the
      // conservative choice; log it so a payload change is visible.
      logger.warn('sentry-mirror: native event with no id, skipping');
      continue;
    }

    let claimed: boolean;
    try {
      claimed = await deps.claimEvent(id);
    } catch (error) {
      // Claim store unavailable → do NOT forward. Forwarding without a claim
      // would duplicate on the next overlapping run.
      logger.error('sentry-mirror: claim failed, skipping event', {
        sentryEventId: id,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      continue;
    }

    if (!claimed) {
      result.skippedAlreadyClaimed += 1;
      continue;
    }

    const { error, properties } = toPostHogException(event);
    // distinctId is the device/user when Sentry knows one; otherwise personless.
    capturePostHogException(error, undefined, properties);
    result.forwarded += 1;
  }

  if (result.forwarded > 0) {
    logger.info('sentry-mirror forwarded native events to PostHog', {
      scanned: result.scanned,
      native: result.native,
      forwarded: result.forwarded,
      skippedAlreadyClaimed: result.skippedAlreadyClaimed,
    });
  }

  return result;
};
