import { useRuntimeConfig } from '@borradh-workspace/runtime-config/client';
import { Capacitor } from '@capacitor/core';
import { type ReactNode, useEffect, useRef } from 'react';

import { configureApiClientForApp } from '@/lib/api-client';
import { getAuthToken } from '@/lib/auth-token';
import { hideIntercomLauncher } from '@/lib/intercom';
import { registerForPushNotifications } from '@/lib/push';
import { initSentry } from '@/lib/sentry';

/**
 * Runs once on first render after runtime config has resolved:
 *   - Configures the shared api-client with the runtime `apiUrl`.
 *   - Initializes Sentry with the runtime `sentryDsn` / `appEnv`.
 *   - Hides Intercom's floating launcher (native only).
 *
 * Each initializer is idempotent (guarded internally), but the ref guard here
 * skips the StrictMode double-invoke pass to avoid noisy warnings.
 *
 * The downstream tree (QueryClient, PostHog, Router) only renders after this
 * runs, so route loaders that call apiClient see a configured client.
 */
export function TelemetryBootstrap({ children }: { children: ReactNode }) {
  const config = useRuntimeConfig();
  const ran = useRef(false);

  if (!ran.current) {
    configureApiClientForApp(config);
    initSentry(config);
    void hideIntercomLauncher();
    ran.current = true;
  }

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !getAuthToken()) return;
    void registerForPushNotifications();
  }, []);

  return <>{children}</>;
}
