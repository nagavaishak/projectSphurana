/**
 * Canonical mock for `@borradh-workspace/integrations` (root).
 *
 * The real root re-exports every integration subpath (`shared`, `email`, `sms`,
 * `whatsapp`, `voice`, `facebook`, `encryption`, `meta-ads`, `meta-messaging`,
 * `instagram`, `google`, `microsoft`, `booking`, `stripe`, `telnyx`,
 * `geocoding`, `loops`). This mock reproduces every *runtime* export so the real
 * package — which pulls in the AWS SDK, facebook-nodejs-business-sdk, the Stripe
 * SDK, the Notion client, etc. — is never loaded in tests, and so every test
 * file sees the *same* mock — a prerequisite for `isolate: false`. See
 * docs/plans/features-test-isolation-windows.md.
 *
 * Conventions:
 * - External-boundary functions → behaviour-free `vi.fn()`.
 * - Service classes → `vi.fn()` constructors returning a stable shared instance
 *   object (auto-vivified `vi.fn()` methods); no per-file `mockImplementation`
 *   state to leak under a shared module registry.
 * - `shared/` exports (the Meta error registry/classifier + OAuth-proxy state
 *   signing) are PURE logic over static data with no external dependency — they
 *   are re-exported REAL, exactly like `database/schema` constants are aliased
 *   real. Production code (`handle-meta-error.ts`, etc.) imports them un-mocked
 *   and depends on their real classification behaviour. `MetaApiError` /
 *   `TelnyxApiError` likewise stay real classes so `instanceof` keeps working.
 *
 * Test files should NOT `vi.mock('@borradh-workspace/integrations')` — import
 * the symbol and drive it with `vi.mocked()`. `beforeEach(vi.clearAllMocks())`
 * resets call history between tests.
 */
import { vi } from 'vitest';
import { createServiceMock } from './_integration-service-mock.js';

// ===========================================================================
// shared/  — re-exported REAL (pure logic over static data, no boundaries).
//
// Imported straight from the integrations *source* (not `dist`) so the suite
// never depends on a stale build. `meta-error-registry.ts` has no imports,
// `meta-api-error.ts` imports only the registry, `oauth-proxy.ts` imports only
// `node:crypto` — all pure, all safe to evaluate in-process during tests.
// ===========================================================================

export {
  MetaApiError,
  extractMetaErrorContext,
  getMetaErrorInfo,
  getMetaErrorMessage,
  parseMetaErrorResponse,
} from '../../../integrations/src/shared/meta-api-error.js';

// `isMetaAuthError` is pure classification logic, but the refresh-token services
// (refresh-instagram-tokens, refresh-meta-tokens) drive it directly to force the
// auth-error branch in tests. Expose it as a `vi.fn` whose DEFAULT implementation
// is the REAL classifier — so files that don't override it (handle-meta-error,
// deliver-messages, sync-conversation-messages, …) keep real behaviour, exactly
// as when it was a plain re-export — while a test can drive it with
// `vi.mocked(isMetaAuthError).mockReturnValueOnce(true)` (mirrors the canonical
// `isRateLimitError = vi.fn(() => false)` pattern).
import { isMetaAuthError as realIsMetaAuthError } from '../../../integrations/src/shared/meta-api-error.js';
export const isMetaAuthError = vi.fn(realIsMetaAuthError);

export {
  lookupMetaError,
  resolveActionUrl,
  MetaErrorKeys,
} from '../../../integrations/src/shared/meta-error-registry.js';

export {
  buildOAuthProxyParams,
  getOAuthProxyConfig,
  getProxyRedirectUri,
  signProxyState,
} from '../../../integrations/src/shared/oauth-proxy.js';

// ===========================================================================
// email/  +  sms/
// ===========================================================================

const sesEmailService = createServiceMock();
export const mockSESEmailService = sesEmailService.instance;
export const SESEmailService = sesEmailService.ctor;

const snsSmsService = createServiceMock();
export const mockSNSSMSService = snsSmsService.instance;
export const SNSSMSService = snsSmsService.ctor;

// ===========================================================================
// whatsapp/
// ===========================================================================

const whatsAppCloudService = createServiceMock();
export const mockWhatsAppCloudService = whatsAppCloudService.instance;
export const WhatsAppCloudService = whatsAppCloudService.ctor;

const whatsAppOAuthService = createServiceMock();
export const mockWhatsAppOAuthService = whatsAppOAuthService.instance;
export const WhatsAppOAuthService = whatsAppOAuthService.ctor;

// ===========================================================================
// voice/
// ===========================================================================

const telnyxAiService = createServiceMock();
export const mockTelnyxAiService = telnyxAiService.instance;
export const TelnyxAiService = telnyxAiService.ctor;
export const createTelnyxAiService = vi.fn(() => mockTelnyxAiService);

/** Real-ish error class so `instanceof TelnyxApiError` keeps working. */
export class TelnyxApiError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TelnyxApiError';
    this.statusCode = statusCode;
  }
}

// Calendar providers
const freshaProvider = createServiceMock();
const phorestProvider = createServiceMock();
const timelyProvider = createServiceMock();
const calendlyProvider = createServiceMock();
export const FreshaProvider = freshaProvider.ctor;
export const PhorestProvider = phorestProvider.ctor;
export const TimelyProvider = timelyProvider.ctor;
export const CalendlyProvider = calendlyProvider.ctor;
export const createCalendarProvider = vi.fn();
export const formatSlotsForVoice = vi.fn();
export const parseTimePreference = vi.fn();
export const filterSlotsByTimeOfDay = vi.fn();

// Telnyx webhook handlers
export const verifyTelnyxWebhookSignature = vi.fn();
export const parseTelnyxWebhookEvent = vi.fn();
export const processTelnyxWebhookEvent = vi.fn();
export const analyzeCallOutcome = vi.fn();
export const inferSentiment = vi.fn();
export const createWebhookResponse = vi.fn();
export const createWebhookErrorResponse = vi.fn();
export const generateCallSummary = vi.fn();
export const extractCrmUpdateData = vi.fn();

// ===========================================================================
// facebook/
// ===========================================================================

const facebookLeadsService = createServiceMock();
export const mockFacebookLeadsService = facebookLeadsService.instance;
export const FacebookLeadsService = facebookLeadsService.ctor;

// ===========================================================================
// encryption/
// ===========================================================================

export const encryptCredentials = vi.fn();
export const decryptCredentials = vi.fn();
export const generateEncryptionKey = vi.fn();

// ===========================================================================
// meta-ads/
// ===========================================================================

const metaAdsService = createServiceMock();
export const mockMetaAdsService = metaAdsService.instance;
export const MetaAdsService = metaAdsService.ctor;

// MetaAppSecretMismatchError must be a real class so `instanceof` works in
// handle-meta-error.ts and the scheduler. Inlined here (rather than imported
// from the real source) to avoid pulling MetaAdsService and its heavy deps
// into the mock.
import type { MetaApiError as _MetaApiErrorForMismatch } from '../../../integrations/src/shared/meta-api-error.js';
export class MetaAppSecretMismatchError extends Error {
  readonly metaError: _MetaApiErrorForMismatch;
  constructor(metaError: _MetaApiErrorForMismatch) {
    super(metaError.message);
    this.name = 'MetaAppSecretMismatchError';
    this.metaError = metaError;
  }
}

const metaOAuthService = createServiceMock();
export const mockMetaOAuthService = metaOAuthService.instance;
export const MetaOAuthService = metaOAuthService.ctor;

// ===========================================================================
// meta-messaging/
// ===========================================================================

const metaMessagingService = createServiceMock();
export const mockMetaMessagingService = metaMessagingService.instance;
export const MetaMessagingService = metaMessagingService.ctor;

// ===========================================================================
// instagram/
// ===========================================================================

const instagramOAuthService = createServiceMock();
export const mockInstagramOAuthService = instagramOAuthService.instance;
export const InstagramOAuthService = instagramOAuthService.ctor;

// ===========================================================================
// google/
// ===========================================================================

const gmailOAuthService = createServiceMock();
export const GmailOAuthService = gmailOAuthService.ctor;

const gmailSendService = createServiceMock();
export const GmailSendService = gmailSendService.ctor;

const googleCalendarOAuthService = createServiceMock();
export const GoogleCalendarOAuthService = googleCalendarOAuthService.ctor;

const googleCalendarService = createServiceMock();
export const GoogleCalendarService = googleCalendarService.ctor;

const googleDriveOAuthService = createServiceMock();
export const GoogleDriveOAuthService = googleDriveOAuthService.ctor;

const googleDriveApiService = createServiceMock();
export const GoogleDriveApiService = googleDriveApiService.ctor;
export const ALLOWED_VIDEO_TYPES: string[] = [
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/webm',
];
export const MAX_FILE_SIZE_BYTES: number = 5 * 1024 * 1024 * 1024;

const googleMyBusinessOAuthService = createServiceMock();
export const GoogleMyBusinessOAuthService = googleMyBusinessOAuthService.ctor;
export const starRatingToNumber = vi.fn();
export const buildReviewLink = vi.fn();

// ===========================================================================
// microsoft/
// ===========================================================================

const outlookOAuthService = createServiceMock();
export const OutlookOAuthService = outlookOAuthService.ctor;

const outlookSendService = createServiceMock();
export const OutlookSendService = outlookSendService.ctor;

// ===========================================================================
// booking/
// ===========================================================================

const calendlyOAuthService = createServiceMock();
export const CalendlyOAuthService = calendlyOAuthService.ctor;

const calendlyApiService = createServiceMock();
export const CalendlyApiService = calendlyApiService.ctor;

const timelyOAuthService = createServiceMock();
export const TimelyOAuthService = timelyOAuthService.ctor;

const phorestApiService = createServiceMock();
export const PhorestApiService = phorestApiService.ctor;

// ===========================================================================
// stripe/
// ===========================================================================

const stripeService = createServiceMock();
export const mockStripeService = stripeService.instance;
export const StripeService = stripeService.ctor;
export const getStripeService = vi.fn(() => mockStripeService);

const stripeConnectService = createServiceMock();
export const mockStripeConnectService = stripeConnectService.instance;
export const StripeConnectService = stripeConnectService.ctor;
export const getStripeConnectService = vi.fn(() => mockStripeConnectService);

export const DEFAULT_CREDIT_RATES = {
  sms: 100,
  email: 10,
  voicePerMinute: 500,
  whatsapp: 100,
};

export const DEFAULT_PLAN = {
  id: 'pro',
  name: 'Pro Plan',
  description: 'Full access to all features with monthly credits',
  priceInCents: 40000,
  interval: 'month' as const,
  stripePriceId: '',
  includedCredits: 100000,
  features: [] as string[],
};

export const DEFAULT_CREDIT_PACKAGES = [
  {
    id: 'credits-500',
    name: '500 Credits',
    credits: 50000,
    priceInCents: 5000,
    stripePriceId: '',
  },
];

// ===========================================================================
// telnyx/
// ===========================================================================

const telnyxService = createServiceMock();
export const mockTelnyxService = telnyxService.instance;
export const TelnyxService = telnyxService.ctor;
export const createTelnyxService = vi.fn(() => mockTelnyxService);

// ===========================================================================
// geocoding/
// ===========================================================================

export const geocodeAddress = vi.fn();

// ===========================================================================
// loops/
// ===========================================================================

const loopsService = createServiceMock();
export const mockLoopsService = loopsService.instance;
export const LoopsService = loopsService.ctor;
