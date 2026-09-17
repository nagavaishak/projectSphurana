export const config = { runtime: 'edge' };

/**
 * Same-origin PostHog reverse proxy (the `/r3y` path — deliberately opaque, not
 * the well-known `/ingest` that blocker lists match).
 *
 * Why a function and not a vercel.json rewrite straight to eu.i.posthog.com:
 * Vercel's external `rewrites` only forward GET for this static (Vite) project
 * — POST to an external rewrite returns 405 (the SPA fallback rejects the
 * method). PostHog ingestion (`/e/`, `/flags/`, `/decide/`) is POST, so the
 * rewrite silently dropped every event. A function proxies all methods + body.
 *
 * Routing: vercel.json rewrites `/r3y/:path*` to this flat function, passing
 * the upstream path as the `phPath` query param (Vercel's api/ dir doesn't
 * register a [...catchall] for non-Next projects). `static/*` goes to the asset
 * host; everything else to the ingestion host.
 */
const API_HOST = 'https://eu.i.posthog.com';
const ASSET_HOST = 'https://eu-assets.i.posthog.com';

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let phPath = url.searchParams.get('phPath') ?? '';
  url.searchParams.delete('phPath');
  // Fallback if the request reaches here unrewritten.
  if (!phPath) phPath = url.pathname.replace(/^\/r3y\/?/, '');

  const base = phPath.startsWith('static/') ? ASSET_HOST : API_HOST;
  const upstreamUrl = `${base}/${phPath}${url.search}`;

  const headers = new Headers(request.headers);
  headers.delete('host'); // fetch derives Host from the upstream URL
  headers.delete('content-length'); // fetch recomputes it for the forwarded body

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
  });

  const responseHeaders = new Headers();
  const contentType = upstream.headers.get('content-type');
  if (contentType) responseHeaders.set('content-type', contentType);
  const cacheControl = upstream.headers.get('cache-control');
  if (cacheControl) responseHeaders.set('cache-control', cacheControl);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
