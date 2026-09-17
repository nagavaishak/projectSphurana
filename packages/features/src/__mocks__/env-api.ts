/**
 * Canonical mock for `@borradh-workspace/env/api`.
 *
 * Aliased in vite.config.ts so tests never run the real `createEnv` (which
 * validates `process.env` against the API schema and would fail in CI without
 * the full set of env vars), and so every test file sees the *same* config
 * object — a prerequisite for `isolate: false`. See
 * docs/plans/features-test-isolation-windows.md.
 *
 * env is CONFIG, not behaviour: this is a static fake object literal, not a set
 * of `vi.fn()`s. Tests that need a specific value should not mock the env — they
 * should test against these plausible fakes (or use a per-file `vi.mock`, which
 * is the responsibility of Windows A–E and overrides this alias anyway).
 */

export const apiEnv = {
  PORT: 3000,
  NODE_ENV: 'test' as const,

  // Instagram FLfB routing override (off in tests → PostHog/default decides)
  INSTAGRAM_FLFB_ROUTING: false,

  // Onboarding sample-asset shortcut (off in tests → real generation path)
  ONBOARDING_SAMPLE_ASSETS: false,

  // Shared Gemini image admission limits. The per-day value mirrors the
  // shipped default of 0 = count, never refuse; tests that need enforcement
  // drive the Redis mock's reply directly rather than changing this.
  GEMINI_IMAGE_REQUESTS_PER_MINUTE: 8,
  GEMINI_IMAGE_REQUESTS_PER_DAY: 0,

  // Google OAuth (Gmail + Calendar)
  GOOGLE_CLIENT_ID: 'mock-google-client-id',
  GOOGLE_CLIENT_SECRET: 'mock-google-client-secret',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://mock.example.com/oauth/google/callback',
  GOOGLE_GMB_OAUTH_REDIRECT_URI:
    'https://mock.example.com/oauth/google-gmb/callback',

  // Google Calendar webhook verification token
  GOOGLE_CALENDAR_WEBHOOK_TOKEN: 'mock-google-calendar-webhook-token',

  // Microsoft OAuth (Outlook)
  MICROSOFT_CLIENT_ID: 'mock-microsoft-client-id',
  MICROSOFT_CLIENT_SECRET: 'mock-microsoft-client-secret',
  MICROSOFT_OAUTH_REDIRECT_URI:
    'https://mock.example.com/oauth/microsoft/callback',

  // Meta/Facebook integration
  META_APP_ID: 'mock-meta-app-id',
  META_LOGIN_CONFIG_ID: 'mock-meta-login-config-id',
  META_APP_SECRET: 'mock-meta-app-secret',
  META_INSTAGRAM_APP_SECRET: 'mock-meta-instagram-app-secret',
  META_WEBHOOK_VERIFY_TOKEN: 'mock-meta-webhook-verify-token',
  META_OAUTH_REDIRECT_URI: 'https://mock.example.com/oauth/meta/callback',
  INSTAGRAM_APP_ID: 'mock-instagram-app-id',
  INSTAGRAM_OAUTH_REDIRECT_URI:
    'https://mock.example.com/oauth/instagram/callback',

  // Credential encryption — 64-char hex so encryption services accept it.
  INTEGRATION_ENCRYPTION_KEY:
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',

  // Calendly OAuth
  CALENDLY_CLIENT_ID: 'mock-calendly-client-id',
  CALENDLY_CLIENT_SECRET: 'mock-calendly-client-secret',
  CALENDLY_OAUTH_REDIRECT_URI:
    'https://mock.example.com/oauth/calendly/callback',

  // Timely OAuth
  TIMELY_CLIENT_ID: 'mock-timely-client-id',
  TIMELY_CLIENT_SECRET: 'mock-timely-client-secret',
  TIMELY_OAUTH_REDIRECT_URI: 'https://mock.example.com/oauth/timely/callback',

  // OAuth proxy
  OAUTH_PROXY_BASE_URL: undefined as string | undefined,
  OAUTH_PROXY_STATE_SECRET: undefined as string | undefined,

  // Pexels (stock images)
  PEXELS_API_KEY: 'mock-pexels-api-key',

  // Figma (template import)
  FIGMA_ACCESS_TOKEN: 'mock-figma-access-token',

  // Stripe Connect
  STRIPE_CONNECT_WEBHOOK_SECRET: 'mock-stripe-connect-webhook-secret',

  // CORS and Cookie settings
  API_URL: 'https://mock-api.example.com',
  WEB_URL: 'https://mock-web.example.com',
  // Deliberately a DIFFERENT host from WEB_URL: they are different apps
  // (dashboard vs marketing), and a test that shared one host between them
  // would pass just as happily if a builder used the wrong one.
  MARKETING_URL: 'https://mock-marketing.example.com',
  MOBILE_URL: 'https://mock-mobile.example.com',
  COOKIE_DOMAIN: 'mock.example.com',

  // E2E Testing
  E2E_SEED_TOKEN: 'mock-e2e-seed-token-0123456789abcdef0123456789',
  E2E_TEST_EMAIL: 'e2e@example.com',

  // Google Maps
  GOOGLE_MAPS_API_KEY: 'mock-google-maps-api-key',

  // OpenAI
  OPENAI_API_KEY: 'mock-openai-api-key',

  // Anthropic
  ANTHROPIC_API_KEY: 'mock-anthropic-api-key',

  // Google Gemini (image generation) — truthy so the AI-image path is enabled
  // for resolve-slot-image / generate-ai-image tests.
  GOOGLE_GENAI_API_KEY: 'mock-google-genai-api-key',

  // Claire flags (deprecated no-ops)
  CLAIRE_V3_ENABLED: true,
  CLAIRE_V3_ALLOW_ORG_IDS: [] as string[],

  // Claire WhatsApp sender number (used to build the wa.me pairing link)
  CLAIRE_WHATSAPP_NUMBER: '14155551234',

  // CDN and App URLs
  CDN_URL: 'https://mock-cdn.example.com',
  APP_URL: 'https://mock-app.example.com',

  // Cloudflare Turnstile
  TURNSTILE_SECRET_KEY: 'mock-turnstile-secret-key',

  // Intercom identity verification
  INTERCOM_IDENTITY_SECRET: 'mock-intercom-identity-secret',

  // Intercom REST API
  INTERCOM_ACCESS_TOKEN: 'mock-intercom-access-token',
  INTERCOM_ADMIN_ID: 'mock-intercom-admin-id',

  // Ops alert email
  ALERT_EMAIL: 'alerts@example.com',

  // Push notifications — FCM + APNs
  FCM_SERVICE_ACCOUNT_BASE64: undefined as string | undefined,
  APNS_KEY_ID: undefined as string | undefined,
  APNS_TEAM_ID: undefined as string | undefined,
  APNS_KEY_P8_BASE64: undefined as string | undefined,
  APNS_BUNDLE_ID: undefined as string | undefined,
  APNS_PRODUCTION: false,
  FCM_DRY_RUN: false,
};
