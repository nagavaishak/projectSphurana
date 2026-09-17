import { useRuntimeConfig } from '@borradh-workspace/runtime-config/client';
import { Capacitor } from '@capacitor/core';
import posthog from 'posthog-js';
import {
  PostHogProvider as PHProvider,
  useFeatureFlagEnabled,
  useFeatureFlagPayload,
} from 'posthog-js/react';
import { useEffect, useRef } from 'react';

import { flushPostHogErrorQueue } from '@/lib/log-error';
import { dropPostHogNoise } from '@/lib/posthog-noise-filter';
import { getPosthogKey, trackEvent } from '@/lib/track-event';
import { router } from '@/router';

/**
 * PostHog for the Vite app: feature flags + optional capture.
 * Init only when `posthogKey` is set in runtime config (matches Next web behavior when key absent).
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const { posthogKey, posthogHost, appEnv } = useRuntimeConfig();
  const initialized = useRef(false);

  // Web bundle ALWAYS routes PostHog through the same-origin /r3y proxy (Vercel
  // rewrites it to eu.i.posthog.com, incl. /static for the recorder). The path
  // is a deliberately opaque token — NOT the well-known `/ingest`, which blocker
  // lists (uBlock/AdGuard/EasyPrivacy) now match by path. `posthogHost` must NOT
  // override this on web: when set, posthog-js would hit eu.i.posthog.com
  // directly and blockers kill every request (and the recorder module import).
  // Native (Capacitor) has no proxy server, so it uses posthogHost / direct.
  const apiHost =
    Capacitor.getPlatform() === 'web'
      ? '/r3y'
      : (posthogHost ?? 'https://eu.i.posthog.com');

  useEffect(() => {
    if (initialized.current) return;
    if (!posthogKey) return;

    posthog.init(posthogKey, {
      api_host: apiHost,
      ui_host: 'https://eu.posthog.com',
      capture_pageview: false,
      capture_pageleave: true,
      persistence: 'localStorage+cookie',
      respect_dnt: true,
      // Exception autocapture is OFF on purpose. It installs its handlers from
      // a lazily-fetched `exception-autocapture.js`, so it is armed late (and,
      // if that request is blocked, never) — which left boot-time unhandled
      // errors in Sentry with no PostHog twin (WEB-15, WEB-29). We install the
      // listeners ourselves, synchronously, in lib/global-error-handlers.ts.
      // Turning this back on would double-capture every unhandled error.
      capture_exceptions: false,
      // Drop the same non-defects Sentry drops (extension injection, expected
      // user conditions, one client's connectivity). Without this, PostHog
      // inherits noise Sentry has been absorbing — and that noise is what made
      // the Sentry issue stream unreadable in the first place.
      before_send: dropPostHogNoise,
    });

    initialized.current = true;

    // Super property on every event so staging/preview data stays separable
    // from production in the shared PostHog project.
    posthog.register({ environment: appEnv });

    // Replay anything that failed before posthog-js was ready — the window
    // between Sentry's synchronous init and this effect.
    flushPostHogErrorQueue();

    // Capture the initial pageview, then one per client-side navigation. This
    // provider sits ABOVE RouterProvider, so we subscribe to the router
    // imperatively rather than via useRouterState (no router context here).
    const capturePageview = () => {
      if (!posthog.__loaded) return;
      posthog.capture('$pageview', { $current_url: window.location.href });
    };
    capturePageview();
    return router.subscribe('onResolved', capturePageview);
  }, [posthogKey, apiHost, appEnv]);

  if (!posthogKey) {
    return <>{children}</>;
  }

  return <PHProvider client={posthog}>{children}</PHProvider>;
}

export function identifyUser(
  userId: string,
  properties?: {
    email?: string;
    name?: string;
    [key: string]: unknown;
  }
) {
  if (!getPosthogKey()) return;
  if (!posthog.__loaded) return;
  posthog.identify(userId, properties);
}

export function setUserGroup(
  groupType: string,
  groupId: string,
  properties?: Record<string, unknown>
) {
  if (!getPosthogKey()) return;
  posthog.group(groupType, groupId, properties);
}

export function resetUser() {
  if (!getPosthogKey()) return;
  posthog.reset();
}

// Router-free, so a feature hook can capture without dragging the route tree
// in through this module. See @/lib/track-event.
export { trackEvent };

/**
 * Reactively read a boolean feature flag for the current user/org. Re-renders
 * when the flag value changes. Defaults to `false` while flags load or when
 * PostHog is disabled — the safe default for canary gating (off until proven on).
 *
 * Flags evaluate against the identified user AND their groups (the org set via
 * {@link setUserGroup}), so org-targeted canary rollouts work out of the box.
 */
export function useFlag(flagKey: string): boolean {
  return useFeatureFlagEnabled(flagKey) ?? false;
}

/**
 * Reactively read a multivariate flag's payload (or `undefined`). Use for flags
 * that carry config (e.g. a canary variant's parameters), not just on/off.
 */
export function useFlagPayload<T = unknown>(flagKey: string): T | undefined {
  return useFeatureFlagPayload(flagKey) as T | undefined;
}

/**
 * Imperative (non-hook) flag check for use outside React render — event
 * handlers, loaders, plain functions. Returns `false` until flags have loaded.
 * Prefer {@link useFlag} inside components so the UI reacts to flag changes.
 */
export function isFlagEnabled(flagKey: string): boolean {
  if (!getPosthogKey()) return false;
  if (!posthog.__loaded) return false;
  return posthog.isFeatureEnabled(flagKey) ?? false;
}
