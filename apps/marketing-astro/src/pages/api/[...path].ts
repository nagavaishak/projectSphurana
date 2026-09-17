// Same-origin API proxy for microsite hosts (tenant custom domains,
// *.borradh.io, previews).
//
// WHY THIS EXISTS
// The customer portal is served from the tenant's own domain, where
// api.borradh.io is cross-site. Better Auth's patient session is an httpOnly
// cookie, and a cross-site cookie is a third-party cookie — blocked outright by
// Safari ITP and Chrome tracking protection. Routing API calls through this
// route keeps them same-origin with the page, so the cookie is first-party.
//
// WHY A FUNCTION AND NOT A vercel.json REWRITE
// A rewrite to an external origin DROPS Set-Cookie — documented at
// packages/api-client/src/client.ts:210 and worked around the same way in
// apps/app/api/nest.ts. A function proxy copies Set-Cookie through explicitly.
// Do not "simplify" this into a rewrite: sign-in still appears to succeed, the
// cookie silently never sticks, and the next request is anonymous.
//
// This also satisfies CSP by construction: apps/marketing-astro/vercel.json
// sets `connect-src 'self'` with no API origin, so a direct call to
// api.borradh.io from a microsite page is refused by the browser. Same-origin
// /api/* is covered by 'self'.
export const prerender = false;

import type { APIRoute } from 'astro';

import { resolveUpstreamApiUrl } from '@/lib/config';
import { rescopeCookieForHost } from '@/lib/proxy-cookies';

const handler: APIRoute = async ({ params, request }) => {
  // Resolved per request, not at module scope: on previews it derives from
  // Vercel git env, and a module-scope read would bake in whatever was set
  // when the lambda cold-started.
  const apiUrl = resolveUpstreamApiUrl();
  if (!apiUrl) return new Response('API not configured', { status: 503 });

  const path = params.path ?? '';
  const search = new URL(request.url).search;
  const target = `${apiUrl.replace(/\/$/, '')}/${path}${search}`;

  // Forward the client's headers, minus the hop-by-hop ones fetch recomputes.
  // `host` must go or the upstream sees the tenant domain instead of the API.
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('content-length');
  headers.delete('connection');

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    // OAuth initiator routes answer 302 to the provider. Following it here
    // would proxy the provider's HTML under our path instead of bouncing the
    // browser, so the 3xx must pass through.
    redirect: 'manual',
  });

  // Rebuild rather than copy: each Set-Cookie must stay its own header line.
  // A folded Headers value corrupts any cookie whose Expires contains a comma.
  const responseHeaders = new Headers();
  for (const name of ['content-type', 'location', 'cache-control']) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  const publicHost = request.headers.get('host') ?? '';
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append(
      'set-cookie',
      rescopeCookieForHost(cookie, publicHost)
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
