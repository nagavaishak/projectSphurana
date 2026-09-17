import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z
    .enum(['development', 'staging', 'production'])
    .optional(),
  SENTRY_RELEASE: z.string().optional(),
  LOGTAIL_TOKEN: z.string().optional(),
  // Redis is shared with the api / worker. Subscriber state lives there.
  REDIS_URL: z.string().min(1),
  // Bearer token required to mutate subscribers via /subscribe and DELETE
  // /subscribe/:id. Webhook delivery to /webhook/* is unauthenticated —
  // providers' own signatures are pass-through verified by the subscriber.
  WEBHOOK_ROUTER_TOKEN: z.string().min(16),
  // Forwarded request timeout in ms — keep tight so the upstream provider
  // gets a fast 2xx even if a subscriber is slow.
  FORWARD_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  // Per-provider webhook verify tokens. JSON map keyed by provider slug
  // (matches the :provider segment of /webhook/:provider/*). When a GET
  // arrives that looks like Meta's hub-mode-subscribe handshake AND
  // hub.verify_token matches the configured token for that provider,
  // the router echoes hub.challenge directly with content-type text/plain
  // — no subscriber proxy needed. This is what the Meta dashboard's
  // "Verify and Save" button hits.
  //
  // Format: '{"meta":"<token>","whatsapp":"<token>"}'
  // Optional: when a provider has no entry, verify GETs fall back to
  // fan-out (which doesn't satisfy Meta's handshake — useful only for
  // providers that don't do a verify dance).
  WEBHOOK_VERIFY_TOKENS: z.string().optional(),
  // HMAC secret used to sign/verify the OAuth state-wrapper. The same
  // secret must be present on every service that initiates OAuth (preview
  // API, prod API) so they can sign locally without a round-trip.
  // Optional: when unset, the /oauth/* endpoints return 503.
  OAUTH_PROXY_STATE_SECRET: z.string().min(32).optional(),
  // Comma-separated list of regex patterns for permitted callback origins.
  // Default covers prod, fly per-PR previews, and the legacy staging app.
  // Tighten or override per environment.
  OAUTH_ALLOWED_ORIGINS: z
    .string()
    .default(
      '^https://api\\.borradh\\.com$,^https://borradh-api-pr-[a-z0-9-]+\\.fly\\.dev$,^https://borradh-api-staging\\.fly\\.dev$'
    ),
});

export const env = schema.parse(process.env);

export const verifyTokens: Record<string, string> = (() => {
  if (!env.WEBHOOK_VERIFY_TOKENS) return {};
  try {
    const parsed = JSON.parse(env.WEBHOOK_VERIFY_TOKENS);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error('expected object');
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== 'string')
        throw new Error(`token for ${k} must be string`);
      out[k] = v;
    }
    return out;
  } catch (err) {
    throw new Error(
      `Failed to parse WEBHOOK_VERIFY_TOKENS as JSON object of {provider: token}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
})();

export const oauthAllowedOriginPatterns = env.OAUTH_ALLOWED_ORIGINS.split(',')
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => new RegExp(p));

export const sentryEnvironment =
  env.SENTRY_ENVIRONMENT ??
  (env.NODE_ENV === 'test' ? 'development' : env.NODE_ENV);
