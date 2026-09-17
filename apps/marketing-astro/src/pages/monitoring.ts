// Sentry tunnel — a same-origin reverse proxy for Sentry envelopes, so that
// content blockers matching sentry.io don't drop error / replay events.
// Locked to this app's own configured DSN, so it cannot be abused as an
// open proxy.
export const prerender = false;

import type { APIRoute } from 'astro';

function parseDsn(dsn: string): { host: string; projectId: string } | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, '');
    if (!url.host || !projectId) return null;
    return { host: url.host, projectId };
  } catch {
    return null;
  }
}

export const POST: APIRoute = async ({ request }) => {
  const configured = process.env.MARKETING_SENTRY_DSN
    ? parseDsn(process.env.MARKETING_SENTRY_DSN)
    : null;
  if (!configured) {
    return new Response('Sentry tunnel not configured', { status: 404 });
  }

  // Read the envelope as raw bytes — it may contain binary (e.g. replays).
  const body = await request.arrayBuffer();
  const bytes = new Uint8Array(body);
  const newline = bytes.indexOf(0x0a);
  if (newline === -1) {
    return new Response('Invalid envelope', { status: 400 });
  }

  let envelopeDsn: string | undefined;
  try {
    const header = JSON.parse(
      new TextDecoder().decode(bytes.subarray(0, newline))
    );
    envelopeDsn = header?.dsn;
  } catch {
    return new Response('Invalid envelope header', { status: 400 });
  }

  // Only forward to the exact Sentry project this app is configured for.
  const target = envelopeDsn ? parseDsn(envelopeDsn) : null;
  if (
    !target ||
    target.host !== configured.host ||
    target.projectId !== configured.projectId
  ) {
    return new Response('Forbidden', { status: 403 });
  }

  const upstream = await fetch(
    `https://${configured.host}/api/${configured.projectId}/envelope/`,
    {
      method: 'POST',
      body,
      headers: {
        'Content-Type':
          request.headers.get('content-type') ??
          'application/x-sentry-envelope',
      },
    }
  );

  return new Response(upstream.body, { status: upstream.status });
};
