import { Capacitor } from '@capacitor/core';

import { BUNDLED_CAPACITOR_ORIGINS } from './web-app-origin';

/**
 * URL for {@link RuntimeConfigProvider} to fetch environment config.
 *
 * - **Web / Vite**: same-origin `/api/runtime-config` (Vite middleware or Vercel edge).
 * - **Native + live reload** (`CAP_DEV_SERVER_URL`): WebView origin is the dev server → relative URL.
 * - **Native + bundled** (`cap sync`): WebView is `https://localhost` → fetch `VITE_APP_URL` (or prod default).
 */
export function getRuntimeConfigFetchUrl(): string {
  if (!Capacitor.isNativePlatform()) {
    return '/api/runtime-config';
  }

  if (typeof window !== 'undefined') {
    const { origin } = window.location;
    if (origin && !BUNDLED_CAPACITOR_ORIGINS.has(origin)) {
      return '/api/runtime-config';
    }
  }

  const appHost =
    import.meta.env.VITE_APP_URL?.replace(/\/$/, '') ||
    'https://app.borradh.io';

  // `/api/runtime-config` is served by the SPA host (Vite / Vercel), not NestJS.
  if (/^https?:\/\/api\./i.test(appHost)) {
    console.error(
      '[runtime-config] VITE_APP_URL points at an API host (%s). Use the app origin that serves /api/runtime-config (e.g. app.*.borradh-dev.com or your Vite tunnel), not api.*.',
      appHost
    );
  }

  return `${appHost}/api/runtime-config`;
}
