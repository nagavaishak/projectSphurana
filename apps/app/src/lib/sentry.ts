import { Capacitor } from '@capacitor/core';
import * as Sentry from '@sentry/capacitor';
import * as SentryReact from '@sentry/react';

import type { RuntimeConfig } from '@borradh-workspace/runtime-config/schema';

import { classifyDroppableEvent } from './sentry-filter';

let initialized = false;

export function initSentry(config: RuntimeConfig): void {
  if (initialized) return;
  if (!config.sentryDsn) return;

  const isWeb = Capacitor.getPlatform() === 'web';

  // THE PLATFORM BRANCH. `apps/app` is one codebase serving the browser AND the
  // iOS/Android Capacitor shells, from one DSN, into the one Sentry project
  // (`web`) — WEB-3D "App Hang" and WEB-21 "expired session" are the same
  // project. So "turn Sentry off for web but keep mobile" is not a config
  // change anywhere; it only exists here.
  //
  // Native is unconditional and must stay that way: PostHog on mobile is
  // posthog-js inside a WebView and CANNOT see native crashes or ANRs, and there
  // is no Capacitor-native PostHog SDK. Sentry is a permanent keep there.
  //
  // Web is gated so the cutover is an env-var flip (SENTRY_WEB_DISABLED=true),
  // not a code deploy — and so it can be reverted just as fast if PostHog turns
  // out to be missing something. DEFAULT IS OFF (i.e. Sentry still runs): as of
  // 2026-08-17 the telemetry canary had fired 7 days earlier, so the 30-day
  // quiet streak that should gate this has not been served. Flip it when it has.
  //
  // Leaves `/api/monitoring` (the envelope tunnel) unused on web when flipped.
  // Harmless, and it must stay for the native/rollback path.
  if (isWeb && config.sentryWebDisabled) {
    // Visible in the browser console, because the failure mode of getting this
    // wrong is silence — exactly what is hard to notice.
    console.info(
      '[sentry] web reporting disabled (SENTRY_WEB_DISABLED) — PostHog is the sole error sink on web'
    );
    initialized = true;
    return;
  }

  // On native (iOS/Android via Capacitor) the wrapper installs the native crash handler
  // and forwards JS errors through the React SDK. On web it falls through to React only.
  Sentry.init(
    {
      dsn: config.sentryDsn,
      environment: config.sentryEnvironment ?? config.appEnv,
      tracesSampleRate: config.appEnv === 'production' ? 0.1 : 1.0,
      integrations: [SentryReact.browserTracingIntegration()],
      // Route browser envelopes through our own /api/monitoring endpoint so
      // content blockers that match *.ingest.sentry.io don't drop them.
      // Native (Capacitor) ships through the native SDK and ignores `tunnel`.
      ...(isWeb ? { tunnel: '/api/monitoring' } : {}),
      // Tag the platform so Sentry filters work the same way the Expo app's tags did.
      initialScope: {
        tags: { runtime: Capacitor.getPlatform() },
      },
      // Discard conditions that are not defects: browser-extension injection,
      // user-driven states already surfaced in the UI (expired session, plan
      // gating, declined permission) and one client's connectivity. Each of
      // these used to mint its own Linear ticket via the first-seen alert rule.
      // See sentry-filter.ts — the rules are unit-tested, because the cost of
      // one being too broad is silence.
      beforeSend(event) {
        return classifyDroppableEvent(event) ? null : event;
      },
    },
    SentryReact.init
  );
  initialized = true;
}
