import { timingSafeEqual } from 'node:crypto';
import {
  flushLogs,
  flush as flushSentry,
  initLogger,
  initSentry,
  logError,
} from '@borradh-workspace/observability';
import { getRedis } from '@borradh-workspace/redis';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  env,
  oauthAllowedOriginPatterns,
  sentryEnvironment,
  verifyTokens,
} from './env.js';
import { fanOut } from './forward.js';
import { signState, verifyState } from './oauth.js';
import { SubscriberStore } from './store.js';

const logger = initLogger({
  level: env.LOG_LEVEL,
  logtailToken: env.LOGTAIL_TOKEN,
  environment: env.NODE_ENV,
  serviceName: 'webhook-router',
  pretty: env.NODE_ENV !== 'production',
});

initSentry({
  dsn: env.SENTRY_DSN,
  environment: sentryEnvironment,
  release: env.SENTRY_RELEASE,
});

const store = new SubscriberStore(getRedis());
const app = new Hono();

app.get('/health', (c) =>
  c.json({ status: 'ok', timestamp: new Date().toISOString() })
);

const subscribeSchema = z.object({
  id: z.string().min(1).max(100),
  url: z.string().url(),
  ttlSeconds: z
    .number()
    .int()
    .positive()
    .max(60 * 60 * 24 * 30), // 30 days
});

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function requireAuth(c: Parameters<Parameters<typeof app.post>[1]>[0]) {
  const header = c.req.header('authorization');
  if (!safeCompare(header ?? '', `Bearer ${env.WEBHOOK_ROUTER_TOKEN}`)) {
    return c.text('Unauthorized', 401);
  }
  return null;
}

app.post('/subscribe', async (c) => {
  const unauth = requireAuth(c);
  if (unauth) return unauth;
  const body = await c.req.json().catch(() => null);
  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);
  }
  const sub = await store.upsert(
    parsed.data.id,
    parsed.data.url,
    parsed.data.ttlSeconds
  );
  logger.info('Subscriber upserted', {
    subscriberId: sub.id,
    url: sub.url,
    expiresAt: sub.expiresAt,
  });
  return c.json(sub);
});

app.delete('/subscribe/:id', async (c) => {
  const unauth = requireAuth(c);
  if (unauth) return unauth;
  const id = c.req.param('id');
  const removed = await store.remove(id);
  logger.info('Subscriber removed', { subscriberId: id, removed });
  return c.json({ removed });
});

app.get('/subscribers', async (c) => {
  const unauth = requireAuth(c);
  if (unauth) return unauth;
  return c.json(await store.listActive());
});

/**
 * OAuth proxy.
 *
 * Providers like Meta, Stripe Connect, and Google OAuth require the
 * redirect_uri to exactly match a pre-registered URL — wildcards aren't
 * supported. Per-PR preview hostnames can't be pre-registered (URLs are
 * unbounded). To still test OAuth flows on previews, every initiating
 * service uses this proxy as its redirect_uri and encodes its own origin
 * in an HMAC-signed `state` wrapper. On callback the proxy validates the
 * signature, decodes the origin, and 302s the browser to the originating
 * service's own /auth/{provider}/callback handler — preserving every
 * other query param (notably `code`).
 *
 * The token-exchange call (POST to provider) happens on the originating
 * service itself, NOT here, so the proxy never touches access tokens.
 *
 * For this to work the originating service must:
 *   1. Have OAUTH_PROXY_STATE_SECRET set to the same value as the proxy.
 *   2. Build the OAuth URL with redirect_uri = this proxy's URL.
 *   3. Sign its state with `signState({origin, inner})` (export below).
 *   4. Use the same proxy URL as redirect_uri when exchanging code → token.
 */

// Helper for callers (preview / prod APIs) to compute a signed state via
// HTTP rather than embedding the secret. Auth-protected. Most services
// will instead share OAUTH_PROXY_STATE_SECRET and sign locally — saves a
// round-trip on every OAuth init.
app.post('/oauth/sign-state', async (c) => {
  const unauth = requireAuth(c);
  if (unauth) return unauth;
  if (!env.OAUTH_PROXY_STATE_SECRET) {
    return c.json({ error: 'oauth proxy not configured' }, 503);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({ origin: z.string().url(), inner: z.string().optional() })
    .safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);
  }
  const allowed = oauthAllowedOriginPatterns.some((p) =>
    p.test(parsed.data.origin)
  );
  if (!allowed) {
    return c.json({ error: 'origin not in allowlist' }, 400);
  }
  const state = signState(env.OAUTH_PROXY_STATE_SECRET, parsed.data);
  return c.json({ state });
});

app.get('/oauth/:provider/callback', (c) => {
  const provider = c.req.param('provider');
  const state = c.req.query('state');
  const oauthError = c.req.query('error');

  if (!env.OAUTH_PROXY_STATE_SECRET) {
    logError(
      'webhook-router.oauthProxyConfig',
      new Error('OAUTH_PROXY_STATE_SECRET not configured'),
      { feature: 'webhook-router', extra: { provider } }
    );
    logger.error('OAuth proxy hit but secret unset', { provider });
    return c.text('proxy not configured', 503);
  }
  if (!state) {
    logger.warn('OAuth callback missing state', { provider, oauthError });
    return c.text('missing state', 400);
  }

  const result = verifyState(
    env.OAUTH_PROXY_STATE_SECRET,
    state,
    oauthAllowedOriginPatterns
  );
  if ('error' in result) {
    logger.warn('OAuth callback rejected', { provider, reason: result.error });
    return c.text(`bad state: ${result.error}`, 400);
  }

  // Forward every query param except our wrapper state. The originating
  // service gets back its own opaque `inner` state under the original
  // `state` key. If the wrapper specified a callbackPath, use it; else
  // default to /auth/{provider}/callback for back-compat.
  const path = result.callbackPath ?? `/auth/${provider}/callback`;
  const forwardUrl = new URL(path, result.origin);
  for (const [k, v] of Object.entries(c.req.query())) {
    if (typeof v !== 'string') continue;
    if (k === 'state') {
      if (result.inner) forwardUrl.searchParams.set('state', result.inner);
    } else {
      forwardUrl.searchParams.set(k, v);
    }
  }

  logger.info('OAuth callback proxied', {
    provider,
    origin: result.origin,
    path,
  });
  return c.redirect(forwardUrl.toString(), 302);
});

/**
 * Webhook ingress. Path under /webhook/* is preserved when forwarded —
 * /webhook/stripe → subscriber/webhooks/stripe (note the s on subscriber side).
 *
 * The provider's signature header is preserved verbatim. Each subscriber
 * verifies independently using its own configured secret. Subscribers
 * that share the staging webhook secret with the upstream provider
 * verify successfully; subscribers configured to skip verification (e.g.
 * preview env) do so via their own env flag.
 *
 * We return 2xx to the upstream provider as soon as the body is read; the
 * fan-out runs after the response has been queued, so a slow subscriber
 * can't make Stripe / Meta retry the whole batch.
 */
app.all('/webhook/:provider/*', async (c) => {
  const provider = c.req.param('provider');
  // c.req.path is the full incoming path. Strip the /webhook prefix so the
  // forwarded URL becomes <subscriber>/<rest> — naturally /webhooks/<provider>/<...>
  // for our app convention, but we also accept /webhook/<provider>/<rest>
  // and forward verbatim to /webhooks/<provider>/<rest>.
  const fullPath = c.req.path; // e.g. /webhook/stripe/v1
  const rest = fullPath.replace(/^\/webhook\//, ''); // e.g. stripe/v1
  const destinationPath = `/webhooks/${rest}`;

  const headers = new Headers();
  for (const [k, v] of Object.entries(c.req.header())) {
    if (typeof v === 'string') headers.set(k, v);
  }

  // Meta-style verify handshake: one-time GET ?hub.mode=subscribe with a
  // hub.verify_token (the secret you configure in Meta's dashboard) and a
  // hub.challenge (random nonce). The endpoint is expected to echo the
  // challenge as text/plain when the token matches. We answer it directly
  // — no subscriber proxy needed — using the per-provider token from
  // WEBHOOK_VERIFY_TOKENS.
  //
  // Why not proxy to a subscriber? After staging is gone, no long-lived
  // env owns the test Meta App's verify token; proxying would require
  // designating a per-PR preview as "primary," which would break when
  // that PR closes. Holding the token on the router is simpler and the
  // verify handshake is one-time anyway — actual events still fan out
  // unchanged.
  if (c.req.method === 'GET') {
    const mode = c.req.query('hub.mode');
    const token = c.req.query('hub.verify_token');
    const challenge = c.req.query('hub.challenge');
    if (mode === 'subscribe' && token && challenge) {
      const expected = verifyTokens[provider];
      if (!expected) {
        logger.warn('Verify GET but no token configured for provider', {
          provider,
        });
        return c.text('verify token not configured for provider', 503);
      }
      if (!safeCompare(token, expected)) {
        logger.warn('Verify GET token mismatch', { provider });
        return c.text('forbidden', 403);
      }
      logger.info('Verify GET challenge accepted', { provider });
      return c.text(challenge, 200);
    }
    // Non-handshake GETs are uncommon for webhooks; let them fall through
    // to the fan-out below (they'll be POST-style fan-out with method=GET).
  }

  const body = await c.req.arrayBuffer();
  const subscribers = await store.listActive();
  logger.info('Webhook received', {
    provider,
    destinationPath,
    bodyBytes: body.byteLength,
    subscribers: subscribers.length,
  });

  // Fire-and-forget fan-out — don't make the upstream wait
  void fanOut(subscribers, {
    destinationPath,
    method: c.req.method,
    headers,
    body,
    timeoutMs: env.FORWARD_TIMEOUT_MS,
    logger,
  })
    .then((results) => {
      logger.info('Fan-out complete', {
        provider,
        subscribers: subscribers.length,
        results: results.map((r) => ({
          id: r.subscriberId,
          status: r.status,
        })),
      });
    })
    .catch((err) => {
      logError('webhook-router.fanOutUnexpected', err, {
        feature: 'webhook-router',
        extra: { provider },
      });
      logger.error('Fan-out failed unexpectedly', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        provider,
      });
    });

  return c.json({ received: true, fannedOutTo: subscribers.length });
});

app.notFound((c) => c.text('not found', 404));
app.onError((err, c) => {
  logError('webhook-router.unhandled', err, {
    feature: 'webhook-router',
    extra: {
      path: c.req.path,
      method: c.req.method,
    },
  });
  logger.error('Unhandled error', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    path: c.req.path,
    method: c.req.method,
  });
  return c.text('internal error', 500);
});

serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
  logger.info('Webhook-router listening', { port: info.port });
});

async function shutdown(signal: string) {
  logger.info('Webhook-router shutting down', { signal });
  await Promise.all([flushLogs(), flushSentry(2000)]);
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
