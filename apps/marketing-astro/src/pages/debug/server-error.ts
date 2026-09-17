// Throws a server-side error on an on-demand route, so the PostHog + Sentry
// capture path for marketing SSR can be verified end to end rather than trusted
// on inspection.
//
// This matters more than a normal debug hook: `src/middleware.ts` catches errors
// that propagate out of `next()`, but Astro streams HTML, so an error thrown
// after streaming begins may not surface there. Only firing a real request
// settles whether the middleware sees it. Hit it with `?marker=<id>` and look
// for that marker in PostHog → Error tracking and in Sentry.
//
// OFF BY DEFAULT — 404s unless `DEBUG_ENDPOINTS_ENABLED` is set on the
// deployment, and always 404s on production. See `lib/debug-routes.ts`.
export const prerender = false;

import type { APIRoute } from 'astro';

import {
  debugRouteDisabledResponse,
  debugRoutesEnabled,
} from '@/lib/debug-routes';

export const GET: APIRoute = ({ url }) => {
  if (!debugRoutesEnabled()) return debugRouteDisabledResponse();

  const marker = url.searchParams.get('marker');
  throw new Error(
    marker
      ? `Test marketing SSR error [${marker}]`
      : 'Test marketing SSR error (debug route)'
  );
};
