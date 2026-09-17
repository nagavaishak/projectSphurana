// Reads public runtime config from the environment. Called in Astro page
// frontmatter (build time for static pages, request time for SSR routes)
// and injected into the page as `window.__CONFIG__` + island props.
//
// Everything here ends up in the page source, so the values carry Astro's
// `PUBLIC_` prefix — that is how they are named in Vercel. `API_URL` predates
// the convention and is deployed unprefixed; renaming it would need an env
// change, so it stays as-is rather than reading a variable that isn't set.
//
// These names must match the deployed variables exactly. A typo here does not
// fail the build — it silently yields `null`, or falls through to a default
// that looks plausible, and the feature just never turns on.
import type { RuntimeConfig } from '@/shims/runtime-config';

/**
 * The deploy environment, used to tag every PostHog event (client AND server).
 *
 * `PUBLIC_APP_ENV` is not configured per-environment on this project's Vercel
 * setup, so the previous `?? 'production'` default meant PREVIEW deployments
 * reported `appEnv: "production"` — verified against a live preview on
 * 2026-08-17. Every pageview and client error from a preview was therefore
 * filed under `environment: production` in PostHog, which is the exact field the
 * prod-vs-preview split is queried on. Silent, and it made preview noise
 * indistinguishable from real production incidents.
 *
 * `VERCEL_ENV` ('production' | 'preview' | 'development') is set automatically
 * by Vercel on both builds and requests, so it is a reliable fallback that needs
 * no dashboard configuration. An explicit `PUBLIC_APP_ENV` still wins, so this
 * cannot override a deliberate setting.
 */
export function resolveAppEnv(): string {
  const env = process.env;
  if (env.PUBLIC_APP_ENV) return env.PUBLIC_APP_ENV;
  if (env.VERCEL_ENV) return env.VERCEL_ENV;
  return 'production';
}

/**
 * The upstream API origin for SERVER-side use (the /api/* proxy).
 *
 * On PR previews the API is a per-PR Fly app whose name is only knowable at
 * request time, so it is derived from Vercel's auto-populated git system env
 * rather than asking CI to write a per-PR Vercel env var and redeploy. Same
 * derivation as apps/app/api/runtime-config.ts — the app names are minted in
 * .github/workflows/pr-preview.yml (`steps.names.outputs.api_url`), so these
 * two must stay in sync.
 *
 * Without this the marketing preview has no API_URL at all, and every proxied
 * call 503s — which is also why /book/* has never worked on a marketing
 * preview.
 *
 * The BROWSER's base is a separate thing — see `getPublicConfig` below.
 */
export function resolveUpstreamApiUrl(): string {
  const env = process.env;
  if (env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_PULL_REQUEST_ID) {
    return `https://borradh-api-pr-${env.VERCEL_GIT_PULL_REQUEST_ID}.fly.dev`;
  }
  return env.API_URL ?? '';
}

export function getPublicConfig(): RuntimeConfig {
  const env = process.env;
  return {
    /**
     * The BROWSER's API base: this app's own `/api/*` proxy, never a
     * cross-origin host.
     *
     * It used to be `env.API_URL`, which broke in two ways at once:
     *
     *  - PREVIEWS have no `API_URL` (the per-PR Fly app's name is only
     *    knowable at request time, which is why `resolveUpstreamApiUrl` above
     *    exists). The base collapsed to '', so the booking wizard fetched a
     *    same-origin `/public/booking/{slug}` that is not a route, got a 404,
     *    and rendered "Page not found". That is why `/book/*` had never worked
     *    on a marketing preview.
     *  - PRODUCTION set it to `https://api.borradh.io`, which the deployed CSP
     *    does not allow: `connect-src` lists 'self' and the analytics hosts,
     *    and no API host. A cross-origin base was unreachable there too.
     *
     * The same-origin proxy satisfies both, is what the customer portal
     * already uses (plan §6.1), and keeps the session cookie first-party.
     * `API_URL` stays the SERVER-side upstream that proxy forwards to.
     */
    apiUrl: '/api',
    appUrl: env.PUBLIC_APP_URL ?? 'https://app.borradh.io',
    posthogKey: env.PUBLIC_POSTHOG_KEY ?? null,
    posthogHost: env.PUBLIC_POSTHOG_HOST ?? null,
    marketingSentryDsn: env.PUBLIC_SENTRY_DSN ?? null,
    appEnv: resolveAppEnv(),
  };
}
