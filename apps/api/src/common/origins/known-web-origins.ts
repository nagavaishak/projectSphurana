import { apiEnv } from '@borradh-workspace/env/api';

/**
 * The origins that are OURS — the browser and native front-ends allowed to
 * talk to this API, and the only ones it will send a user back to on an
 * outbound redirect.
 *
 * This lives in one module because two callers need the same answer and
 * drifting between them is a security bug rather than an inconsistency:
 *
 *  - `main.ts` CORS decides which origins may read a credentialed response.
 *  - `publicReturnUrl()` decides which origins Stripe may redirect a user to
 *    after Connect onboarding.
 *
 * Note the two are NOT interchangeable on their own. `capacitor://localhost`
 * and `https://localhost` are legitimate CORS origins (a native WebView really
 * does send them) but are useless as redirect targets, so `publicReturnUrl()`
 * rejects unreachable schemes and loopback hosts BEFORE consulting this
 * allow-list. Keep that ordering if either caller changes.
 */
const STATIC_ORIGINS = (): string[] =>
  [
    'http://localhost:3001', // Web app
    'http://localhost:8081', // Mobile (Expo)
    'http://localhost:5173', // Vite dev (apps/app)
    'http://localhost:4173', // Vite preview (apps/app)
    'capacitor://localhost', // Capacitor iOS webview (apps/app native build)
    'https://localhost', // Capacitor iOS dev https
    'https://app.borradh.io', // Production apps/app (Vite SPA)
    'https://borradh.io', // Production apps/marketing-astro (apex)
    'https://www.borradh.io', // Production marketing (apex redirect target)
    apiEnv.WEB_URL,
    apiEnv.MOBILE_URL,
  ].filter(Boolean) as string[];

/**
 * Vercel preview deployments — the hostname is dynamic per push, so it is
 * matched by pattern. Covers both the unique deployment URL and the stable git
 * branch alias, for every front-end project under our team.
 */
const VERCEL_PREVIEW =
  /^https:\/\/borradh(-(web|app|marketing))?-[a-z0-9-]+-borradh-technologies\.vercel\.app$/;

/** Dev/staging environments on borradh-dev.com (e.g. app.pavit.borradh-dev.com). */
const DEV_STAGING = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.borradh-dev\.com$/;

/** The exact origins allowed, before the two dynamic patterns are considered. */
export function knownWebOrigins(): string[] {
  return STATIC_ORIGINS();
}

/** True when `origin` (scheme + host + port, no path) is one of our front-ends. */
export function isKnownWebOrigin(origin: string): boolean {
  if (STATIC_ORIGINS().includes(origin)) return true;
  if (VERCEL_PREVIEW.test(origin)) return true;
  if (DEV_STAGING.test(origin)) return true;
  return false;
}
