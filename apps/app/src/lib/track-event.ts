import posthog from 'posthog-js';

/**
 * Analytics capture, WITHOUT the router.
 *
 * `trackEvent` used to live in `@/components/posthog-provider`, which imports
 * `@/router` so the provider can subscribe to `onResolved` for pageviews. That
 * made every module reaching for a one-line capture pull the whole route tree
 * in behind it — enough to break any test that renders a component without a
 * router (`No "createRootRouteWithContext" export is defined on the
 * "@tanstack/react-router" mock`) as soon as a feature barrel exported a hook
 * that tracked. The capture itself needs none of that, so it lives here and
 * `posthog-provider` re-exports it for existing callers.
 */
export function getPosthogKey(): string | undefined {
  const config = typeof window !== 'undefined' ? window.__CONFIG__ : undefined;
  return (config as { posthogKey?: string } | undefined)?.posthogKey;
}

export function trackEvent(
  eventName: string,
  properties?: Record<string, unknown>
) {
  if (!getPosthogKey()) return;
  posthog.capture(eventName, properties);
}
