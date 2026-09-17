import type { RuntimeConfig } from '@borradh-workspace/runtime-config/schema';
import { runtimeConfigSchema } from '@borradh-workspace/runtime-config/schema';

/**
 * Runtime config baked into the Capacitor bundle at build time (from `.env` via Vite).
 *
 * Used when the WebView cannot fetch `/api/runtime-config` (wrong host, offline, etc.).
 * Set `VITE_API_URL`, `VITE_APP_URL`, `VITE_POSTHOG_*` in `.env` before `cap sync` / release builds.
 *
 * ── Why the `satisfies` below matters ────────────────────────────────────────
 * The server path (`packages/runtime-config/src/server.ts`) reads its env names
 * from `runtimeConfigEnvMap`, which is `satisfies Record<keyof RuntimeConfig, string>`
 * — so a new schema field CANNOT be forgotten there. This object literal is the
 * build-time twin, and until now it had no such constraint: a field added to
 * `runtimeConfigSchema` simply never got baked, arrived as `undefined` on native,
 * and — because most fields are `.optional()` — `safeParse` still SUCCEEDED. That
 * is exactly how `stripePublishableKey` ended up dead on Capacitor (card checkout
 * UI silently `return null`s, no error, no log).
 *
 * `satisfies Record<keyof RuntimeConfig, unknown>` makes the omission a compile
 * error. Vite requires the FULL static string `import.meta.env.VITE_X` (dynamic
 * indexing is not statically replaced), so the accesses stay spelled out here
 * rather than derived from the map.
 */
export function getBuildTimeRuntimeConfig(): RuntimeConfig | null {
  const apiUrl = import.meta.env.VITE_API_URL?.trim();
  const appUrl = import.meta.env.VITE_APP_URL?.trim();
  const posthogKey = import.meta.env.VITE_POSTHOG_KEY?.trim();
  const posthogHost = import.meta.env.VITE_POSTHOG_HOST?.trim();

  if (!apiUrl || !appUrl || !posthogKey || !posthogHost) {
    return null;
  }

  const raw = {
    apiUrl,
    appUrl,
    appEnv: import.meta.env.VITE_APP_ENV || 'production',
    posthogKey,
    posthogHost,
    sentryDsn: import.meta.env.VITE_SENTRY_DSN || null,
    sentryEnvironment: import.meta.env.VITE_SENTRY_ENVIRONMENT,
    marketingSentryDsn: import.meta.env.VITE_MARKETING_SENTRY_DSN || null,
    sentryWebDisabled: import.meta.env.VITE_SENTRY_WEB_DISABLED === 'true',
    intercomAppId: import.meta.env.VITE_INTERCOM_APP_ID || null,
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    turnstileSiteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
    stripePublishableKey: import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY,
    metaAppId: import.meta.env.VITE_META_APP_ID,
    metaLoginConfigId: import.meta.env.VITE_META_LOGIN_CONFIG_ID,
    whatsappEmbeddedSignupConfigId: import.meta.env
      .VITE_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID,
    cdnUrl: import.meta.env.VITE_CDN_URL,
    cdnEnabled: import.meta.env.VITE_CDN_ENABLED === 'true',
    s3PublicAssetsBucket: import.meta.env.VITE_S3_PUBLIC_ASSETS_BUCKET,
    s3Region: import.meta.env.VITE_S3_REGION,
  } satisfies Record<keyof RuntimeConfig, unknown>;

  const parsed = runtimeConfigSchema.safeParse(raw);

  if (!parsed.success) {
    console.warn(
      '[build-time-runtime-config] invalid VITE_* env:',
      parsed.error.issues.map((i) => i.message).join('; ')
    );
    return null;
  }

  return parsed.data;
}
