export const config = { runtime: 'edge' };

/**
 * Same-origin API proxy — PR preview deployments only.
 *
 * On a preview the SPA (*.vercel.app) and the API (*.fly.dev) are different
 * sites, so Better Auth issues the session cookie as SameSite=None. That's a
 * third-party cookie, and real browsers (Safari ITP, Chrome tracking
 * protection) block it — sign-in then silently fails because the cookie
 * never sticks. Routing API calls through this function keeps them
 * same-origin with the SPA, so the cookie is first-party.
 *
 * Why a function and not a vercel.json rewrite straight to Fly: a rewrite to
 * an external origin drops Set-Cookie (packages/api-client/src/client.ts
 * documents this). A function proxy copies Set-Cookie through explicitly.
 *
 * Routing: Vercel's api/ directory doesn't register a [...catchall] function
 * for non-Next projects, so vercel.json rewrites /api/nest/:path* to this
 * flat function, passing the upstream path as the `nestPath` query param.
 *
 * Production is unaffected: there the SPA's apiUrl is the absolute API URL
 * (see api/runtime-config.ts), so /api/nest is never requested. The env gate
 * below also hard-stops this route anywhere but a PR preview.
 */
export default async function handler(request: Request): Promise<Response> {
  // PREVIEW_API_ORIGIN — explicit upstream override, set on the deployment.
  //
  // The PR-number derivation below can only ever aim at a PR-numbered Fly app,
  // which meant a preview frontend could not be pointed at any other backend.
  // The scheduled nightly needs exactly that: an ephemeral `borradh-api-nightly`
  // spun up for the test window (see .github/workflows/e2e-nightly.yml). The
  // override takes precedence; PR deploys set nothing and keep deriving.
  //
  // Still gated on VERCEL_ENV === 'preview'. Production resolves an absolute
  // apiUrl (api/runtime-config.ts) and never requests this route, so leaving
  // the gate in place keeps the proxy unreachable there even if the override
  // leaks into a production env by accident.
  const prNumber = process.env.VERCEL_GIT_PULL_REQUEST_ID;
  const originOverride = process.env.PREVIEW_API_ORIGIN;
  if (process.env.VERCEL_ENV !== 'preview' || (!prNumber && !originOverride)) {
    return new Response('Not found', { status: 404 });
  }

  // Per-PR Fly app name — same derivation as api/runtime-config.ts.
  // `||`, not `??`: an env var set to the empty string must fall through to the
  // PR derivation, not win it and proxy every request to "/…".
  const upstreamBase = (
    originOverride || `https://borradh-api-pr-${prNumber}.fly.dev`
  ).replace(/\/+$/, '');

  const url = new URL(request.url);
  // The vercel.json rewrite hands the upstream path as `nestPath`. Fall back
  // to stripping the pathname in case the request reaches here unrewritten.
  let nestPath = url.searchParams.get('nestPath');
  url.searchParams.delete('nestPath');
  if (nestPath === null) {
    nestPath = url.pathname.replace(/^\/api\/nest\/?/, '');
  }
  const upstreamUrl = `${upstreamBase}/${nestPath}${url.search}`;

  const headers = new Headers(request.headers);
  headers.delete('host'); // fetch derives Host from the upstream URL
  headers.delete('content-length'); // fetch recomputes it for the forwarded body

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  // redirect:'manual' — OAuth initiator routes (e.g. integrations/meta-ads/auth)
  // respond 302 to the provider. Following it here would proxy facebook.com's
  // HTML under /api/nest/... instead of bouncing the browser; the 3xx must be
  // passed through so the browser navigates to the provider itself.
  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
  });

  // Rebuild headers so each Set-Cookie stays its own header line — a folded
  // Headers value corrupts cookies whose Expires attribute contains a comma.
  const responseHeaders = new Headers();
  const contentType = upstream.headers.get('content-type');
  if (contentType) responseHeaders.set('content-type', contentType);
  const location = upstream.headers.get('location');
  if (location) responseHeaders.set('location', location);
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append('set-cookie', cookie);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
