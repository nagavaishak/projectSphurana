/**
 * Append a caller-supplied correlation marker to a probe message.
 *
 * `scripts/verify-error-sinks.mjs` fires each reporting path with a unique
 * marker, then looks for that marker in BOTH Sentry and PostHog. That only
 * works if the marker survives into the message text — the one field every sink
 * indexes. Without it a probe can only be matched by its message, which cannot
 * tell this run's event apart from a previous run's.
 *
 * A module-level function rather than a private controller method: Gate 5
 * (`controller-thinness.spec.ts`) forbids helpers on controllers outright, and
 * it is right to — the rule is what keeps handlers readable as "call the use
 * case, return it".
 */
/**
 * Prefixed onto every message these endpoints emit.
 *
 * A raw `throw` reaches the global exception filter with no scope to hang tags
 * on, so the marker has to live in the message itself. Sentry and PostHog both
 * index the message, which makes this filterable in an inbound rule or an alert
 * condition — and readable at a glance in a triage queue, which is what was
 * missing when a probe run became Sentry issue API-FE and spawned an incident PR.
 */
export const SYNTHETIC_PREFIX = '[synthetic]';

export const withMarker = (message: string, marker?: string): string =>
  marker
    ? `${SYNTHETIC_PREFIX} ${message} [${marker}]`
    : `${SYNTHETIC_PREFIX} ${message} (debug endpoint)`;
