import type { RuntimeConfig } from './schema.js';

/**
 * The ONE declaration of "which environment variable feeds which RuntimeConfig field".
 *
 * Consumed by:
 *  - `server.ts`            → reads `process.env` on the API / Vercel edge function.
 *  - `apps/app/vite.config.ts` → bakes `VITE_<NAME>` into the Capacitor bundle.
 *
 * `satisfies Record<keyof RuntimeConfig, string>` is the gate: adding a field to
 * `runtimeConfigSchema` without adding it here is a COMPILE ERROR, so a new
 * field cannot silently arrive as `undefined` on native (which is exactly how
 * `stripePublishableKey` ended up dead in the Capacitor build — the schema marks
 * it `.optional()`, so `safeParse` succeeded and the Stripe UI just never
 * rendered).
 *
 * The Vite build reads the same names with a `VITE_` prefix (`API_URL` →
 * `VITE_API_URL`), falling back to the unprefixed name.
 */
export const runtimeConfigEnvMap = {
  apiUrl: 'API_URL',
  appUrl: 'APP_URL',
  appEnv: 'APP_ENV',
  posthogKey: 'POSTHOG_KEY',
  posthogHost: 'POSTHOG_HOST',
  sentryDsn: 'SENTRY_DSN',
  sentryEnvironment: 'SENTRY_ENVIRONMENT',
  marketingSentryDsn: 'MARKETING_SENTRY_DSN',
  sentryWebDisabled: 'SENTRY_WEB_DISABLED',
  intercomAppId: 'INTERCOM_APP_ID',
  googleMapsApiKey: 'GOOGLE_MAPS_API_KEY',
  turnstileSiteKey: 'TURNSTILE_SITE_KEY',
  stripePublishableKey: 'STRIPE_PUBLISHABLE_KEY',
  metaAppId: 'META_APP_ID',
  metaLoginConfigId: 'META_LOGIN_CONFIG_ID',
  whatsappEmbeddedSignupConfigId: 'WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID',
  cdnUrl: 'CDN_URL',
  cdnEnabled: 'CDN_ENABLED',
  s3PublicAssetsBucket: 'S3_PUBLIC_ASSETS_BUCKET',
  s3Region: 'S3_REGION',
} as const satisfies Record<keyof RuntimeConfig, string>;

export type RuntimeConfigEnvName =
  (typeof runtimeConfigEnvMap)[keyof typeof runtimeConfigEnvMap];

/** The `VITE_`-prefixed name Vite bakes into the client bundle. */
export const viteEnvName = (name: RuntimeConfigEnvName): `VITE_${string}` =>
  `VITE_${name}` as const;
