export const config = { runtime: 'edge' };

const ALLOWED_SENTRY_HOST =
  process.env.SENTRY_HOST ?? 'o4510765780107264.ingest.de.sentry.io';

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const envelope = await request.text();
  const firstNewline = envelope.indexOf('\n');
  if (firstNewline === -1) {
    return new Response('Invalid envelope', { status: 400 });
  }

  let dsn: URL;
  try {
    const header = JSON.parse(envelope.slice(0, firstNewline)) as {
      dsn?: string;
    };
    if (!header.dsn) return new Response('Missing DSN', { status: 400 });
    dsn = new URL(header.dsn);
  } catch {
    return new Response('Invalid envelope header', { status: 400 });
  }

  if (dsn.hostname !== ALLOWED_SENTRY_HOST) {
    return new Response('Forbidden Sentry host', { status: 403 });
  }

  const projectId = dsn.pathname.replace(/^\//, '');
  if (!/^\d+$/.test(projectId)) {
    return new Response('Invalid project id', { status: 400 });
  }

  const upstreamUrl = `https://${ALLOWED_SENTRY_HOST}/api/${projectId}/envelope/`;
  const upstream = await fetch(upstreamUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-sentry-envelope' },
    body: envelope,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type':
        upstream.headers.get('content-type') ?? 'application/json',
    },
  });
}
