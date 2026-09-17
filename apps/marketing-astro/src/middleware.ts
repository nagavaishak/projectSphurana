// Two jobs, in order:
//
// 1. HOST → MICROSITE routing. `{slug}.borradh.io` and a tenant's own
//    `salon.com` serve the same pages as `www.borradh.io/sites/{slug}` — by
//    rewriting internally onto those routes, so the visitor's URL never gains a
//    `/sites/` prefix and the three tiers cannot drift apart. The rules live in
//    `pages/_microsite-routing.ts`; this file is the wiring.
//
// 2. Catching errors thrown while rendering on-demand routes (`/blog`, `/book`,
//    anything with `export const prerender = false`) and reporting them to
//    PostHog. Sentry already sees these via `@sentry/astro`'s server
//    integration; this is the missing PostHog half. See
//    `lib/server-observability.ts` for why.
//
// The error is ALWAYS re-thrown — Astro still renders its own error response.
// That second half only observes.
//
// KNOWN LIMIT: this catches errors that propagate out of `next()`. Astro streams
// HTML, so an error thrown after the response has begun streaming may surface
// inside the stream rather than as a rejection here, and would be missed.
// Verify with the `/debug/server-error` route rather than assuming — that route
// exists precisely so this can be checked against real prod behaviour instead
// of trusted on inspection. It is off unless `DEBUG_ENDPOINTS_ENABLED` is set
// on the deployment; see `lib/debug-routes.ts`.
import { defineMiddleware } from 'astro:middleware';
import { resolveUpstreamApiUrl } from '@/lib/config';
import { captureServerException } from '@/lib/server-observability';
import {
  decideMicrositeRoute,
  micrositeHostErrorResponse,
} from '@/pages/_microsite-routing';

export const onRequest = defineMiddleware(async (context, next) => {
  try {
    // Behind Vercel, `context.url.host` is the internal rewrite target rather
    // than the domain the visitor typed, so the forwarded header wins — the
    // same reason `sites/[slug]/[...path].astro` reads it. Get this wrong and
    // every tenant-host request resolves to the platform host and finds nothing.
    const host = context.request.headers.get('host') ?? context.url.host;

    const route = await decideMicrositeRoute(
      { host, pathname: context.url.pathname, search: context.url.search },
      { apiUrl: resolveUpstreamApiUrl() }
    );

    if (route.kind === 'not-found' || route.kind === 'unavailable') {
      // 404, NEVER a redirect (contract §3). A misconfigured DNS record must
      // not become a redirect loop — that looks like a total outage and is far
      // harder to diagnose than a 404 on one hostname. 503 is kept distinct so
      // "the API blinked" is never mistaken for "this domain is not set up".
      return micrositeHostErrorResponse(route.kind);
    }

    if (route.kind === 'rewrite') {
      // Handed downstream so the page does not resolve the same host a SECOND
      // time — one resolve per request, not two.
      //
      // This is also how the PORTAL works on a custom domain (contract §5.1):
      // the slug is resolved SERVER-SIDE from the host and delivered as the
      // `/sites/{slug}` route param the portal pages already read, which is the
      // same channel the path tier uses. It is never guessed from the hostname
      // — a wrong guess would show one clinic's customer another clinic's
      // portal.
      context.locals.microsite = route.site;
      return await next(route.path);
    }

    // Stored rather than returned directly — `return await next()` inside a try
    // still invokes the catch, but @sentry/astro's middleware comments call this
    // out explicitly, so keep the same shape to avoid a subtle divergence.
    const response = await next();
    return response;
  } catch (error) {
    // Logged unconditionally, and BEFORE the capture attempt. A 2026-08-17
    // preview probe (a throwing SSR route) reached NEITHER PostHog nor Sentry,
    // and with a silent catch there was no way to tell "this handler never ran"
    // from "the capture failed". Vercel logs are drained to Better Stack, so this
    // line is the diagnostic. Do not remove it for tidiness.
    console.error(
      `[middleware] caught SSR error on ${context.request.method} ${context.url.pathname}:`,
      error instanceof Error ? error.message : String(error)
    );
    await captureServerException(error, {
      url: context.url.href,
      route: context.routePattern,
      method: context.request.method,
    });
    throw error;
  }
});
