// @deploy 2026-06-11 — retrigger preview for PR #454
import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AppRuntimeConfigProvider } from '@/components/app-runtime-config-provider';
import { PostHogProvider } from '@/components/posthog-provider';
import { TelemetryBootstrap } from '@/components/telemetry-bootstrap';
import { rehydrateAuthToken } from '@/lib/auth-token';
import { installCapgoFailureReporting } from '@/lib/capgo';
import {
  clearChunkReloadGuard,
  installChunkReloadHandler,
} from '@/lib/chunk-reload';
import { configureNativeViewport } from '@/lib/configure-native-viewport';
import { installDeepLinkListener } from '@/lib/deep-links';
import { installGlobalErrorHandlers } from '@/lib/global-error-handlers';
import { queryClient } from '@/lib/query-client';
import { registerSessionInvalidationHandler } from '@/lib/session-lifecycle';
import { router } from '@/router';

import '@/styles.css';

// FIRST, before anything else can throw. PostHog's own exception autocapture
// arms itself from a lazily-fetched script well after init, so unhandled errors
// during boot used to reach Sentry only. These listeners buffer into
// log-error.ts and replay once posthog-js is ready.
installGlobalErrorHandlers();

if (Capacitor.isNativePlatform()) {
  configureNativeViewport();
  document.documentElement.classList.add('native-app');
  if (Capacitor.getPlatform() === 'ios') {
    document.documentElement.classList.add('native-ios');
  }
}

// Tell Capgo the new JS bundle launched successfully so it doesn't roll back
// to the previous one. Must run early; if the app crashes before this fires,
// Capgo restores the prior bundle on next launch.
if (Capacitor.isNativePlatform()) {
  void CapacitorUpdater.notifyAppReady();
  // Register BEFORE any update check can fire, so a download/apply failure on
  // this launch is reported rather than lost. A failed OTA is otherwise
  // silent — the app falls back to the baked bundle and boots normally.
  installCapgoFailureReporting();
  // Emit which bundle actually booted, on a fixed single-line prefix.
  //
  // This is the assertion target for the OTA gate. The E2E APK is built with
  // CAP_DEFAULT_CHANNEL set, so when Capgo serves the bundle the app runs the
  // OTA'd JS — but if the download or apply FAILS, it silently falls back to
  // the copy baked into the APK. That fallback is built from the same source,
  // so every Maestro flow would still pass and the gate would be theatre.
  // apps/app/scripts/maestro-android.sh greps logcat for this line and fails
  // when the version is not the one CI just uploaded.
  //
  // Deliberately console.log rather than the app logger: it has to survive in
  // a release-profile WebView with no transport configured, and reach logcat
  // through Capacitor's console bridge.
  void CapacitorUpdater.current()
    .then(({ bundle }) => {
      console.log(`[capgo-boot] version=${bundle.version} id=${bundle.id}`);
    })
    .catch(() => {
      console.log('[capgo-boot] version=unknown id=unknown');
    });
}

installDeepLinkListener();

// An API-proven expired token is a normal authentication transition, not an
// exception for whichever protected query happened to run first. Clear its
// cached identity and re-run the route guard so it sends the user to sign-in.
registerSessionInvalidationHandler(() => {
  queryClient.clear();
  void router.navigate({ to: '/sign-in' });
});

// Auto-recover from stale dynamic-import / chunk-load failures after a deploy
// (e.g. "Load failed" on a hashed `/assets/index-*.js`). Must run before the
// router mounts so the first lazy route load is covered.
installChunkReloadHandler();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

// Restore the persisted bearer before mounting — the first `auth/session`
// query inside `_authed.beforeLoad` needs it, otherwise cold-launch always
// redirects to /sign-in.
void rehydrateAuthToken().finally(() => {
  // Boot reached the render path successfully — reset the reload guard so a
  // future stale-deploy in this same tab can recover again.
  clearChunkReloadGuard();
  createRoot(rootElement).render(
    <StrictMode>
      <AppRuntimeConfigProvider>
        <TelemetryBootstrap>
          <QueryClientProvider client={queryClient}>
            <PostHogProvider>
              <RouterProvider router={router} />
            </PostHogProvider>
          </QueryClientProvider>
        </TelemetryBootstrap>
      </AppRuntimeConfigProvider>
    </StrictMode>
  );
});

// preview rebuild trigger (ENG-367 ghost commit) — 2026-06-13
