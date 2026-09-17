import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const apiEnv = createEnv({
  server: {
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),

    // Mobile version gate (GET /app-version/check).
    //
    // MIN — below this the app hard-blocks with an update prompt. Raising it
    // locks out every install below that version, and those users cannot be
    // rescued by an OTA bundle, only by a store update. Raise it deliberately,
    // and only once the replacement build is actually released.
    //
    // LATEST — below this the app shows a dismissible nudge. Safe to bump on
    // every release.
    //
    // All four are optional and the check fails open when unset: no value
    // means nobody is gated. A typo here must never brick the install base.
    MOBILE_MIN_VERSION_IOS: z.string().optional(),
    MOBILE_MIN_VERSION_ANDROID: z.string().optional(),
    MOBILE_LATEST_VERSION_IOS: z.string().optional(),
    MOBILE_LATEST_VERSION_ANDROID: z.string().optional(),

    // Google OAuth (Gmail + Calendar)
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
    GOOGLE_GMB_OAUTH_REDIRECT_URI: z.string().url().optional(),

    // Google Calendar webhook verification token
    GOOGLE_CALENDAR_WEBHOOK_TOKEN: z.string().optional(),

    // Microsoft OAuth (Outlook)
    MICROSOFT_CLIENT_ID: z.string().optional(),
    MICROSOFT_CLIENT_SECRET: z.string().optional(),
    MICROSOFT_OAUTH_REDIRECT_URI: z.string().url().optional(),

    // Meta/Facebook integration (Meta Ads, Lead Forms, WhatsApp)
    // Single app for all Meta services - WhatsApp uses these same credentials
    META_APP_ID: z.string().optional(),
    META_APP_SECRET: z.string().optional(),
    META_INSTAGRAM_APP_SECRET: z.string().optional(),
    META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
    META_OAUTH_REDIRECT_URI: z.string().url().optional(),
    // Facebook Login for Business configuration id. Required only for the
    // shareable self-serve link, which builds the dialog URL server-side —
    // the in-app popup reads its own copy from VITE_META_LOGIN_CONFIG_ID.
    META_LOGIN_CONFIG_ID: z.string().optional(),
    // Dedicated Claire WhatsApp number (E.164 digits, e.g. 14155551234) used to
    // build the wa.me pairing deep link. Optional in dev — the pairing service
    // falls back to a placeholder link when unset.
    CLAIRE_WHATSAPP_NUMBER: z.string().optional(),
    // Dedicated Claire WABA credentials (separate from the lead-receptionist
    // number). The webhook only routes to Claire when the inbound
    // `phone_number_id` equals CLAIRE_WHATSAPP_PHONE_NUMBER_ID. The worker uses
    // the access token to send Claire's outbound text/media. Optional — values
    // are the operator's (see plan §0); the flag-off path never reads them.
    CLAIRE_WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    CLAIRE_WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    // Dedicated Claire WhatsApp Business Account id — required by the Graph API
    // template endpoints (`message_templates`). Used by WS-11 to submit the
    // proactive nudge templates (`daily_lead_recap`, etc.) and to list existing
    // templates for idempotency. Optional — operator-provided (plan §0.C).
    CLAIRE_WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
    // Master flag for Claire-on-WhatsApp. When false (default) the webhook
    // Claire branch is a no-op and the receptionist path is untouched.
    CLAIRE_WHATSAPP_ENABLED: z.coerce.boolean().default(false),
    // Sub-flag for PROACTIVE nudges (WS-11). Default false even when the master
    // flag is on, because nudges require operator-APPROVED templates in the Meta
    // UI (plan §0.C) — flip to true only once the templates are approved.
    CLAIRE_WHATSAPP_PROACTIVE_ENABLED: z.coerce.boolean().default(false),
    // Env-stub opt-out list for proactive nudges (WS-11): comma/space-separated
    // owner E.164 numbers (digits only) that should NOT receive nudges. Interim
    // until a persistent per-owner opt-out column lands (FOLLOW-UP — see
    // proactive-nudges/opt-out.ts). Optional; empty = nobody opted out.
    CLAIRE_WHATSAPP_OPTED_OUT: z.string().optional(),
    // Instagram Login API (has its own App ID and App Secret, separate from Meta)
    INSTAGRAM_APP_ID: z.string().optional(),
    INSTAGRAM_OAUTH_REDIRECT_URI: z.string().url().optional(),

    // Credential encryption (required in production to encrypt stored OAuth tokens)
    INTEGRATION_ENCRYPTION_KEY: z
      .string()
      .min(64)
      .optional()
      .refine(
        (val) => val !== undefined || process.env.NODE_ENV !== 'production',
        { message: 'INTEGRATION_ENCRYPTION_KEY is required in production' }
      ),

    // Calendly OAuth
    CALENDLY_CLIENT_ID: z.string().optional(),
    CALENDLY_CLIENT_SECRET: z.string().optional(),
    CALENDLY_OAUTH_REDIRECT_URI: z.string().url().optional(),

    // Timely OAuth
    TIMELY_CLIENT_ID: z.string().optional(),
    TIMELY_CLIENT_SECRET: z.string().optional(),
    TIMELY_OAUTH_REDIRECT_URI: z.string().url().optional(),

    // OAuth proxy (webhook router). When set, every OAuth service swaps
    // its redirect_uri for the proxy and wraps state with origin so the
    // proxy can route callbacks back to this preview / prod instance.
    // Same OAUTH_PROXY_STATE_SECRET must be set on the router and on
    // every signer (this api). When unset, services fall back to their
    // per-provider *_OAUTH_REDIRECT_URI env vars (local dev / pre-rollout).
    OAUTH_PROXY_BASE_URL: z.string().url().optional(),
    OAUTH_PROXY_STATE_SECRET: z.string().min(32).optional(),

    // Pexels (stock images)
    PEXELS_API_KEY: z.string().optional(),

    // Figma (template import)
    FIGMA_ACCESS_TOKEN: z.string().optional(),

    // Canva (template import — legacy static token, deprecated once OAuth is live)
    CANVA_ACCESS_TOKEN: z.string().optional(),

    // Canva OAuth (Connect API — replaces static token for per-org connections)
    CANVA_CLIENT_ID: z.string().optional(),
    CANVA_CLIENT_SECRET: z.string().optional(),
    /**
     * Redirect URI registered in the Canva Developer Portal.
     * Defaults to {API_URL}/integrations/canva/callback if not set.
     */
    CANVA_REDIRECT_URI: z.string().url().optional(),

    // Stripe Connect
    STRIPE_CONNECT_WEBHOOK_SECRET: z.string().optional(),

    // Twilio Account auth token — used to verify the `X-Twilio-Signature`
    // header on inbound SMS webhooks. This is the ACCOUNT auth token, distinct
    // from the API-key secret (TWILIO_CLIENT_SECRET) used to authenticate sends.
    // Optional: when unset, webhook signature verification fails open in
    // non-production and fails closed (rejects) in production.
    TWILIO_AUTH_TOKEN: z.string().optional(),

    // Twilio send credentials. These authenticate outbound SMS (HTTP Basic
    // against the REST API) and number provisioning. Declared here rather than
    // read raw off process.env so a partial/missing config is visible at boot
    // instead of surfacing as a Twilio 401 mid-blast.
    //
    // TWILIO_API_SID / TWILIO_CLIENT_SECRET are an API *key* pair (SK…), not
    // the account credentials — the account auth token above is webhook-only.
    TWILIO_API_SID: z.string().startsWith('SK').optional(),
    TWILIO_CLIENT_SECRET: z.string().optional(),
    // Parent account SID (AC…). Optional: resolved from the API key via
    // /Accounts.json when unset, at the cost of one extra round trip per send.
    TWILIO_ACCOUNT_SID: z.string().startsWith('AC').optional(),
    // Messaging Service (MG…) — the sender pool. Required unless every org has
    // its own provisioned number, since sends fall back to it when the org has
    // no `from`.
    TWILIO_MESSAGING_SERVICE_SID: z.string().startsWith('MG').optional(),

    // Campaign sending controls.
    // Skips every real provider call and returns synthetic message ids. Leave
    // unset (false) in production.
    CAMPAIGNS_DRY_RUN: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    // Public base URL Twilio posts inbound SMS to, set as `SmsUrl` when a
    // number is purchased. Defaults to {API_URL}/webhooks/twilio/sms.
    CAMPAIGNS_SMS_WEBHOOK_URL: z.string().url().optional(),

    // Resend webhook signing secret (Svix format, `whsec_…`) — used to verify
    // the svix-id/svix-timestamp/svix-signature headers on Resend email-event
    // webhooks. Same fail-open-in-dev / fail-closed-in-prod policy as Twilio.
    RESEND_WEBHOOK_SECRET: z.string().optional(),

    // CORS and Cookie settings
    API_URL: z.string().url().optional(),
    WEB_URL: z.string().url().optional(),
    // The MARKETING app's origin (apps/marketing-astro). Distinct from WEB_URL,
    // which is the dashboard app: the customer-facing surfaces — microsites,
    // the booking flow and the customer portal — moved OFF the dashboard and
    // onto marketing, so every server-built customer link is composed from
    // this and never from WEB_URL. Composing them from WEB_URL sends customers
    // to a host that does not serve the route at all.
    MARKETING_URL: z.string().url().optional(),
    MOBILE_URL: z.string().url().optional(),
    COOKIE_DOMAIN: z.string().optional(),

    // E2E Testing (only needed in test/development)
    E2E_SEED_TOKEN: z.string().min(32).optional(),
    E2E_TEST_EMAIL: z.string().email().optional(),
    // Opt-in flag to allow destructive testing endpoints (cleanup,
    // force-verify, force-subscription, etc.) when NODE_ENV=production.
    // PR-preview Fly apps inherit NODE_ENV=production from fly.toml but
    // need destructive endpoints enabled for CI; set this to true there.
    // Must remain false (default) on real production deploys.
    E2E_DESTRUCTIVE_ALLOWED: z.coerce.boolean().default(false),
    // Swaps the Stripe Connect client for an in-process stub (deterministic
    // ids, instant settlement) so the E2E suite can exercise card / QR /
    // deposit / membership tenders without real Stripe. Set true ONLY on
    // preview / CI hosts alongside E2E_DESTRUCTIVE_ALLOWED; never on real prod.
    // The integrations factory reads process.env.STRIPE_E2E_STUB directly — this
    // entry documents + validates the var where the API boots.
    STRIPE_E2E_STUB: z.coerce.boolean().default(false),
    // Swaps every outbound Meta Graph call for the in-process contract fake
    // (packages/integrations/src/meta-contract) so the connected E2E suite can
    // drive ad publishes, social posts and chatbot delivery without touching
    // real Meta. Set true ONLY on preview / CI hosts alongside
    // E2E_DESTRUCTIVE_ALLOWED; never on real prod.
    //
    // MUST be set on the WORKER too — chatbot delivery and meta-sync run there,
    // and a stubbed API beside a live worker is worse than neither.
    //
    // The boot wiring reads process.env.META_E2E_STUB directly with `=== 'true'`
    // (see main.ts) to dodge the z.coerce.boolean "false" → true footgun; this
    // entry documents + validates the var where the API boots.
    META_E2E_STUB: z.coerce.boolean().default(false),
    // Records real Graph traffic to disk so the contract's response schemas can
    // be written from reality. Enabled on the nightly real-Meta run, never with
    // META_E2E_STUB (there'd be nothing real to record).
    META_CONTRACT_RECORD: z.coerce.boolean().default(false),
    META_CONTRACT_RECORD_DIR: z.string().optional(),
    // Validates REAL Graph responses against the declared response schemas on
    // the nightly run. Report-only: drift is logged, never fatal.
    META_CONTRACT_VALIDATE: z.coerce.boolean().default(false),

    // Google Maps (geocoding, address lookup)
    GOOGLE_MAPS_API_KEY: z.string().optional(),

    // OpenAI (website analysis, AI features)
    OPENAI_API_KEY: z.string().optional(),

    // Website-analysis scraping engine (v2). All optional — the analyzer
    // falls back to a basic native fetch when none are set.
    FIRECRAWL_API_KEY: z.string().optional(),
    BROWSERBASE_API_KEY: z.string().optional(),
    BROWSERBASE_PROJECT_ID: z.string().optional(),
    BROWSER_USE_API_KEY: z.string().optional(),

    // Anthropic (Claire-Owner v3 — Sonnet 4.6 default, Opus 4.7 routing)
    ANTHROPIC_API_KEY: z.string().optional(),

    // ── Gemini image generation ("nano banana") ──────────────────────────────
    //
    // TWO providers, and the choice is a BILLING decision, not a technical one:
    //
    //   aistudio — generativelanguage.googleapis.com, API-key auth. Bills on
    //              the Gemini Developer API's own track. Google Cloud credits
    //              CANNOT be spent here (for accounts created after
    //              2026-03-02 the $300 Welcome credits are explicitly excluded).
    //   vertex   — aiplatform.googleapis.com, OAuth/service-account auth. Bills
    //              as an ordinary Google Cloud service, so it DOES draw down
    //              GCP credits and committed-use discounts.
    //
    // Provider is auto-selected: Vertex when a project + service-account key
    // are configured, otherwise AI Studio. Set GEMINI_PROVIDER to force one
    // (useful for an instant rollback without unsetting credentials).

    // Google AI Studio key. Create at https://aistudio.google.com/apikey —
    // distinct from the OAuth client credentials above.
    GOOGLE_GENAI_API_KEY: z.string().optional(),

    // Force a provider. Omit to auto-select from the Vertex config below.
    GEMINI_PROVIDER: z.enum(['aistudio', 'vertex']).optional(),

    // GCP project that Vertex calls bill to — this is the project whose
    // credits get spent.
    GOOGLE_CLOUD_PROJECT: z.string().optional(),

    // Vertex location. `global` routes to aiplatform.googleapis.com; any other
    // value uses the regional host (e.g. `europe-west1` →
    // europe-west1-aiplatform.googleapis.com). Gemini 3 image models are
    // served on the global endpoint.
    GOOGLE_CLOUD_LOCATION: z.string().default('global'),

    // PREFERRED credential on Fly: Workload Identity Federation. The full
    // workload identity pool provider resource, e.g.
    //   //iam.googleapis.com/projects/<NUM>/locations/global/
    //     workloadIdentityPools/<POOL>/providers/<PROVIDER>
    // When set, the Fly Machine's own OIDC token is exchanged for short-lived
    // Google credentials — nothing long-lived exists to leak. See
    // image-generation/fly-oidc-supplier.ts.
    GOOGLE_VERTEX_WIF_AUDIENCE: z.string().optional(),

    // Service account for the federated identity to impersonate. Optional —
    // the federated principal can hold `aiplatform.user` directly, but
    // impersonating keeps the IAM grant somewhere familiar.
    GOOGLE_VERTEX_SA_EMAIL: z.string().optional(),

    // FALLBACK credential. Service-account JSON key, base64-encoded (raw JSON
    // has newlines inside private_key that most secret stores mangle). Needs
    // the `aiplatform.user` role.
    //
    // PREFER Application Default Credentials instead: ADC is a resolution
    // chain whose external-account link is Workload Identity Federation, which
    // works fine off-GCP — Fly Machines and Vercel both issue OIDC tokens GCP
    // can exchange for short-lived credentials, with no long-lived key to
    // leak. Point GOOGLE_APPLICATION_CREDENTIALS at the WIF config and leave
    // this unset. See docs/guides/vertex-gemini-cutover.md.
    GOOGLE_VERTEX_SA_KEY: z.string().optional(),

    // Image model for the nano-banana engine. gemini-3-pro-image = best text
    // rendering; gemini-3.1-flash-image = cheaper web-app parity.
    //
    // NOTE: model ids can differ between the two providers — Vertex has
    // published Nano Banana Pro as both `gemini-3-pro-image` and
    // `gemini-3-pro-image-preview` depending on release stage. If Vertex
    // returns 404 NOT_FOUND for the publisher model, set this explicitly
    // rather than assuming the credentials are wrong.
    BRANDED_GRAPHIC_MODEL: z.string().default('gemini-3-pro-image'),

    // Shared per-model admission limit for outbound Gemini image requests.
    // This is deliberately a request (not job) limit: one carousel job fans
    // out into several image renders and BullMQ's job limiter cannot protect
    // the provider quota on its own. The conservative default leaves headroom
    // for retries and can be raised only after the Google project quota is.
    GEMINI_IMAGE_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).default(8),

    // The provider's OTHER binding limit, which a per-minute ceiling does not
    // constrain at all: 8/min sustained is 11,520/day, and gemini-3-pro-image
    // allows 250 per project per day.
    //
    // DEFAULT 0 = count, never refuse. Production demand is currently ~2x the
    // provider's daily quota, so any cap we could pick would refuse real work
    // — and refusing it locally is strictly worse than letting the provider
    // decide, because the provider's quota is the thing that can be raised.
    // The counter still runs, so daily consumption is observable in Redis
    // (`gemini:image:requests:day:<provider>:<model>:<YYYY-MM-DD>`). Set this
    // above zero only once the real quota is known and demand fits under it.
    GEMINI_IMAGE_REQUESTS_PER_DAY: z.coerce.number().int().min(0).default(0),

    // Track 19 — AI graphic generation cost caps (USD).
    AI_GRAPHIC_COST_CAP_USER_DAILY_SOFT: z.coerce.number().min(0).default(5),
    AI_GRAPHIC_COST_CAP_USER_DAILY_HARD: z.coerce.number().min(0).default(10),
    AI_GRAPHIC_COST_CAP_ORG_MONTHLY_SOFT: z.coerce.number().min(0).default(200),
    AI_GRAPHIC_COST_CAP_ORG_MONTHLY_HARD: z.coerce.number().min(0).default(500),

    // remove.bg API (paid AI background removal for brand logos)
    REMOVE_BG_API_KEY: z.string().optional(),

    // DEPRECATED 2026-04-26 — Claire v3 is generally available; both flags are
    // no-ops. Kept on the schema so existing Pulumi configs that still set them
    // don't fail validation on next deploy. Safe to remove from infra config +
    // this schema once all envs are cleaned up.
    CLAIRE_V3_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    CLAIRE_V3_ALLOW_ORG_IDS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      ),

    // Row-Level Security. RLS is NOT currently enabled on the database (0
    // policies, 0 tables with row security). While off, the global
    // RlsInterceptor must NOT wrap each request in a transaction: it was
    // holding a DB transaction open for the ENTIRE request lifecycle (incl.
    // external calls) just to run a no-op `set_config`, and under Fly's egress
    // NAT those long-lived transactions got severed mid-flight -> orphaned
    // `idle in transaction` backends -> PgBouncer pool saturation -> database
    // down while Neon was healthy. Default false = interceptor passes through.
    // Flip to true ONLY after real RLS policies exist on the tables.
    RLS_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    // Local/ops override for the `instagram-flfb-routing` PostHog kill-switch.
    // When 'true', Instagram operations route through the Facebook Page's FLfB
    // system-user token (graph.facebook.com) for ALL orgs regardless of the
    // PostHog flag — used to demo IG publishing locally without depending on
    // per-org flag targeting. Default 'false' → PostHog decides (default-off).
    INSTAGRAM_FLFB_ROUTING: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    // Dev/test-only shortcut for the Claire onboarding deck. When 'true', the
    // ad-picker, video-picker and content-approval slides are seeded with
    // ready-made SAMPLE images/videos instead of kicking the real (slow, paid)
    // render pipeline — so you can click through onboarding without waiting on
    // Nano Banana / Remotion. NEVER enable in production. Default 'false' →
    // real generation. Enum-transform idiom (not coerce.boolean) so a literal
    // `=false` stays false.
    ONBOARDING_SAMPLE_ASSETS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    // CDN and App URLs (used by assistant tools)
    CDN_URL: z.string().url().optional(),
    APP_URL: z.string().url().optional(),

    // Cloudflare Turnstile (CAPTCHA)
    TURNSTILE_SECRET_KEY: z.string().optional(),

    // Intercom identity verification (HMAC secret for mobile messenger)
    INTERCOM_IDENTITY_SECRET: z.string().optional(),

    // Intercom REST API (server-side messaging)
    INTERCOM_ACCESS_TOKEN: z.string().optional(),
    INTERCOM_ADMIN_ID: z.string().optional(),

    // Ops alert email (stuck conversations, system health)
    ALERT_EMAIL: z.string().email().optional(),

    // Shared secret for cron-trigger endpoints called from GitHub Actions.
    // Must match the CRON_SECRET repo secret. Optional — if unset, the
    // endpoint rejects all requests so deployments without a secret are safe.
    CRON_SECRET: z.string().min(1).optional(),

    // Push notifications — FCM (Android via Capacitor) and APNs (iOS via
    // Capacitor). 'expo' tokens from legacy apps/mobile are still handled
    // by expo-server-sdk and need no env vars here.
    //
    // FCM: base64-encoded JSON of a Firebase service account key with the
    // Firebase Cloud Messaging API enabled. When unset, FCM delivery is
    // skipped with a warning (tokens are still stored but pushes are no-ops).
    FCM_SERVICE_ACCOUNT_BASE64: z.string().optional(),
    // APNs: Apple Push Notification service auth-key credentials (.p8 token
    // auth, the modern HTTP/2 path — recommended over cert auth).
    APNS_KEY_ID: z.string().optional(),
    APNS_TEAM_ID: z.string().optional(),
    APNS_KEY_P8_BASE64: z.string().optional(),
    APNS_BUNDLE_ID: z.string().optional(),
    APNS_PRODUCTION: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    // Validate the whole FCM path — credentials, payload, token validity —
    // and deliver nothing.
    //
    // This exists because FCM has no sandbox. APNs does: preview sets
    // APNS_PRODUCTION=false and its production device tokens are simply
    // invalid against the sandbox endpoint, so nothing can reach a real phone
    // by accident. FCM has one environment, and preview databases are
    // copy-on-write forks of the prod Neon branch — so `device_push_token`
    // holds REAL customer tokens and an un-guarded preview would push to real
    // Android devices. Same reasoning as CAMPAIGNS_DRY_RUN.
    FCM_DRY_RUN: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    // Internal service credential for loopback acts-as auth. When set, the
    // AuthGuard honors `x-internal-service-token` + `x-acts-as-user-id` +
    // `x-acts-as-organization-id` headers ONLY over the loopback interface
    // (127.0.0.1/::1). Used by the Claire WhatsApp worker to make authenticated
    // API calls as a paired owner without a browser session. Optional in dev —
    // when unset, the internal path is disabled entirely.
    INTERNAL_SERVICE_TOKEN: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
