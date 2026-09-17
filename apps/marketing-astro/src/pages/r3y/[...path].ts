// Reverse proxy for PostHog. Routing analytics through our own origin keeps
// content blockers that match *.i.posthog.com from dropping events.
export const prerender = false;

import type { APIRoute } from 'astro';

const ASSET_HOST = 'https://eu-assets.i.posthog.com';
const API_HOST = 'https://eu.i.posthog.com';

const handler: APIRoute = async ({ params, request }) => {
  const path = params.path ?? '';
  const base = path.startsWith('static/') ? ASSET_HOST : API_HOST;
  const search = new URL(request.url).search;
  const target = `${base}/${path}${search}`;

  const init: RequestInit = { method: request.method };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }
  const contentType = request.headers.get('content-type');
  if (contentType) init.headers = { 'content-type': contentType };

  const upstream = await fetch(target, init);

  const headers = new Headers();
  const ct = upstream.headers.get('content-type');
  if (ct) headers.set('content-type', ct);
  const cacheControl = upstream.headers.get('cache-control');
  if (cacheControl) headers.set('cache-control', cacheControl);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
};

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
