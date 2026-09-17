/**
 * MISC response PROJECTIONS — hand-composed from generated atoms.
 *
 * A grab-bag domain covering the smaller API surfaces: integrations (+ the
 * per-provider account lists), Instagram, notifications, billing, timesheets,
 * voice scripts, face groups, sequences, API keys, training hub, and the
 * embedded Stripe Connect status. Follow the pattern in ./leads.ts / ./sales.ts.
 *
 * Pure Zod, composed with `z.object` / `.extend` / `z.array` / `z.record`.
 * Money is integer cents on the wire (`z.number()`); dates are ISO strings
 * (atoms are already wire-shaped). `$type<>()` text/jsonb columns widen to
 * `z.string()` / `z.unknown()` in the atoms — narrowed back here to match the
 * api-client contract types.
 */
import {
  bookingProviderValues,
  emailProviderValues,
  integrationTypeValues,
  metaIntegrationStatusValues,
  notificationTypeValues,
  tokenStatusValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';
import {
  apikeyAtomSchema,
  creditTransactionsAtomSchema,
  faceGroupAssetAtomSchema,
  faceGroupAtomSchema,
  invoicesAtomSchema,
  notificationAtomSchema,
  organizationIntegrationAtomSchema,
  sequenceAtomSchema,
  subscriptionsAtomSchema,
  timeEntryAtomSchema,
  timeEntryBreakAtomSchema,
  trainingVideoAtomSchema,
  userVideoProgressAtomSchema,
  voiceScriptAtomSchema,
} from '../generated/index.js';

// ============================================================================
// STRIPE TAX
// ============================================================================

/** A Stripe-owned classification displayed in the product and service editors. */
export const stripeTaxCodeOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
});
export type StripeTaxCodeOption = z.infer<typeof stripeTaxCodeOptionSchema>;

/** `GET /integrations/stripe/tax-codes` — cached Stripe Tax catalogue. */
export const listStripeTaxCodesResponseSchema = z.object({
  taxCodes: z.array(stripeTaxCodeOptionSchema),
});
export type ListStripeTaxCodesResponse = z.infer<
  typeof listStripeTaxCodesResponseSchema
>;

// ============================================================================
// NOTIFICATIONS
// ============================================================================

/**
 * A notification feed row. The `notification` atom widens `type` (a
 * `$type<NotificationType>` text column) to `z.string()` and `data` (a typed
 * jsonb payload) to `z.unknown()`; both are narrowed back here to the contract.
 */
export const notificationSchema = notificationAtomSchema.extend({
  type: z.enum(notificationTypeValues),
  data: z.record(z.string(), z.unknown()).nullable(),
});
export type Notification = z.infer<typeof notificationSchema>;

/** `GET /notifications` — the `{ items, total }` feed wrapper. */
export const listNotificationsResponseSchema = z.object({
  items: z.array(notificationSchema),
  total: z.number(),
});
export type ListNotificationsResponse = z.infer<
  typeof listNotificationsResponseSchema
>;

/** `GET /notifications/unread-count` — the unread badge count. */
export const unreadNotificationCountResponseSchema = z.object({
  count: z.number(),
});
export type UnreadNotificationCountResponse = z.infer<
  typeof unreadNotificationCountResponseSchema
>;

/** `POST /notifications/read-all` — the number of rows marked read. */
export const markAllNotificationsReadResponseSchema = z.object({
  updated: z.number(),
});
export type MarkAllNotificationsReadResponse = z.infer<
  typeof markAllNotificationsReadResponseSchema
>;

// ============================================================================
// BILLING — subscription / credits / invoices
// ============================================================================

/** The org subscription row (the atom, verbatim). */
export const subscriptionSchema = subscriptionsAtomSchema;
export type Subscription = z.infer<typeof subscriptionSchema>;

/** An invoice row (the atom, verbatim). Amounts are integer cents. */
export const invoiceSchema = invoicesAtomSchema;
export type Invoice = z.infer<typeof invoiceSchema>;

/**
 * A credit-ledger entry. The atom widens `metadata` (jsonb) to `z.string()`; it
 * stays a string on the wire so no narrowing is needed.
 */
export const creditTransactionSchema = creditTransactionsAtomSchema;
export type CreditTransaction = z.infer<typeof creditTransactionSchema>;

/** `GET /billing/subscription` — the subscription wrapper (null = none). */
export const subscriptionResponseSchema = z.object({
  subscription: subscriptionSchema.nullable(),
});
export type SubscriptionResponse = z.infer<typeof subscriptionResponseSchema>;

/**
 * `GET /billing/credits` — the credit balance response. A COMPUTED shape (not
 * the `credit_balances` atom): only a subset of columns plus derived
 * human-readable values (`creditsAvailable`, `includedMonthly`).
 */
export const creditBalanceResponseSchema = z.object({
  balance: z
    .object({
      id: z.string(),
      organizationId: z.string(),
      balance: z.number(),
      includedCredits: z.number(),
      purchasedCredits: z.number(),
      creditsAvailable: z.number(),
      includedMonthly: z.number(),
    })
    .nullable(),
});
export type CreditBalanceResponse = z.infer<typeof creditBalanceResponseSchema>;

/** A purchasable credit package (computed; no backing table). */
export const creditPackageSchema = z.object({
  id: z.string(),
  name: z.string(),
  credits: z.number(),
  priceInCents: z.number(),
  priceFormatted: z.string(),
  popular: z.boolean().optional(),
});
export type CreditPackage = z.infer<typeof creditPackageSchema>;

/** `GET /billing/credits/packages` — the purchasable packages list. */
export const creditPackagesResponseSchema = z.object({
  packages: z.array(creditPackageSchema),
});
export type CreditPackagesResponse = z.infer<
  typeof creditPackagesResponseSchema
>;

/** Currency-specific price info attached to a billing plan. */
export const currencyPriceSchema = z.object({
  stripePriceId: z.string(),
  priceInCents: z.number(),
});
export type CurrencyPrice = z.infer<typeof currencyPriceSchema>;

/** Supported subscription pricing currency. */
export const supportedCurrencySchema = z.enum(['usd', 'eur', 'gbp']);
export type SupportedCurrency = z.infer<typeof supportedCurrencySchema>;

/** A billing plan (computed static config; no backing table). */
export const billingPlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  priceInCents: z.number(),
  includedCredits: z.number(),
  priceFormatted: z.string(),
  features: z.array(z.string()).optional(),
  currencyPrices: z
    .record(supportedCurrencySchema, currencyPriceSchema)
    .optional(),
});
export type BillingPlan = z.infer<typeof billingPlanSchema>;

/** `GET /billing/plan` — the current plan info. */
export const planInfoResponseSchema = z.object({
  plan: billingPlanSchema,
});
export type PlanInfoResponse = z.infer<typeof planInfoResponseSchema>;

/** `GET /billing/currency` — the currency the Stripe customer is locked to. */
export const billingCurrencyResponseSchema = z.object({
  currency: supportedCurrencySchema.nullable(),
});
export type BillingCurrencyResponse = z.infer<
  typeof billingCurrencyResponseSchema
>;

/** A Stripe Checkout session result (subscription / credits purchase). */
export const checkoutSessionResultSchema = z.object({
  sessionId: z.string(),
  url: z.string(),
});
export type CheckoutSessionResult = z.infer<typeof checkoutSessionResultSchema>;

/** A Stripe billing-portal session result. */
export const portalSessionResultSchema = z.object({
  url: z.string(),
});
export type PortalSessionResult = z.infer<typeof portalSessionResultSchema>;

// ============================================================================
// TIMESHEETS — time entries + breaks
// ============================================================================

/** A time-entry (clock-in/out) row — the atom, verbatim. */
export const timeEntrySchema = timeEntryAtomSchema;
export type TimeEntry = z.infer<typeof timeEntrySchema>;

/** A break row nested under a time entry — the atom, verbatim. */
export const timeEntryBreakSchema = timeEntryBreakAtomSchema;
export type TimeEntryBreak = z.infer<typeof timeEntryBreakSchema>;

/** `GET /time-entries` — a time entry with its nested breaks. */
export const timeEntryWithBreaksSchema = timeEntryAtomSchema.extend({
  breaks: z.array(timeEntryBreakSchema),
});
export type TimeEntryWithBreaks = z.infer<typeof timeEntryWithBreaksSchema>;

// ============================================================================
// VOICE SCRIPTS
// ============================================================================

/** The voice-agent configuration jsonb (open-ended index signature). */
export const agentConfigSchema = z
  .object({
    voice: z.string().optional(),
    language: z.string().optional(),
    maxCallDuration: z.number().optional(),
    endCallAfterSilence: z.number().optional(),
  })
  .catchall(z.unknown());
export type AgentConfig = z.infer<typeof agentConfigSchema>;

/**
 * A voice script. The atom widens the typed jsonb columns
 * (`qualificationQuestions`/`followUps` = `string[]`, `agentConfig`) to
 * `z.unknown()`; narrow them back here to the api-client contract.
 */
export const voiceScriptSchema = voiceScriptAtomSchema.extend({
  qualificationQuestions: z.array(z.string()),
  followUps: z.array(z.string()),
  agentConfig: agentConfigSchema.nullable(),
});
export type VoiceScript = z.infer<typeof voiceScriptSchema>;

/** `GET /voice-scripts` — list projection: `{ items, limit, offset }`. */
export const listVoiceScriptsResponseSchema = z.object({
  items: z.array(voiceScriptSchema),
  limit: z.number(),
  offset: z.number(),
});
export type ListVoiceScriptsResponse = z.infer<
  typeof listVoiceScriptsResponseSchema
>;

// ============================================================================
// FACE GROUPS
// ============================================================================

/** A face-group row — the atom, verbatim. */
export const faceGroupSchema = faceGroupAtomSchema;
export type FaceGroup = z.infer<typeof faceGroupSchema>;

/** A face-group ↔ asset link row — the atom, verbatim. */
export const faceGroupAssetSchema = faceGroupAssetAtomSchema;
export type FaceGroupAsset = z.infer<typeof faceGroupAssetSchema>;

/** A face-group asset with its joined asset display fields. */
export const faceGroupAssetWithDetailsSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  role: z.enum(['before', 'after', 'untagged']),
  asset: z.object({
    id: z.string(),
    name: z.string(),
    blobUrl: z.string(),
    type: z.string(),
  }),
});
export type FaceGroupAssetWithDetails = z.infer<
  typeof faceGroupAssetWithDetailsSchema
>;

/** A face group with its assets (computed, joined projection). */
export const faceGroupWithAssetsSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  clientName: z.string().nullable(),
  serviceId: z.string().nullable(),
  assets: z.array(faceGroupAssetWithDetailsSchema),
});
export type FaceGroupWithAssets = z.infer<typeof faceGroupWithAssetsSchema>;

/**
 * `GET /face-groups/batch/:batchId` — the per-batch grouping result.
 *
 * Groups are now built only by manual before/after pairing, so there is no
 * asynchronous detection pass to wait on: `status` is always `complete`.
 */
export const batchFaceGroupsResponseSchema = z.object({
  faceGroups: z.array(faceGroupWithAssetsSchema),
  status: z.literal('complete'),
});
export type BatchFaceGroupsResponse = z.infer<
  typeof batchFaceGroupsResponseSchema
>;

/** A face-group list item (computed: adds the joined `serviceName`). */
export const faceGroupListItemSchema = z.object({
  id: z.string(),
  clientName: z.string().nullable(),
  clientNotes: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  serviceId: z.string().nullable(),
  serviceName: z.string().nullable(),
  totalDetections: z.number(),
  batchCount: z.number(),
  isExcluded: z.boolean(),
  createdAt: z.string(),
});
export type FaceGroupListItem = z.infer<typeof faceGroupListItemSchema>;

/** `GET /face-groups` — list projection: `{ items, total, limit, offset }`. */
export const listFaceGroupsResponseSchema = z.object({
  items: z.array(faceGroupListItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type ListFaceGroupsResponse = z.infer<
  typeof listFaceGroupsResponseSchema
>;

/** A face-group asset with full asset metadata (`GET /face-groups/:id/assets`). */
export const faceGroupAssetItemSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  role: z.enum(['before', 'after', 'untagged']),
  asset: z.object({
    id: z.string(),
    name: z.string(),
    blobUrl: z.string(),
    type: z.string(),
    duration: z.number().nullable(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    createdAt: z.string(),
  }),
});
export type FaceGroupAssetItem = z.infer<typeof faceGroupAssetItemSchema>;

/** `GET /face-groups/:id/assets` — the face group plus its detailed assets. */
export const getFaceGroupAssetsResponseSchema = z.object({
  faceGroup: z.object({
    id: z.string(),
    clientName: z.string().nullable(),
    thumbnailUrl: z.string().nullable(),
    serviceId: z.string().nullable(),
  }),
  assets: z.array(faceGroupAssetItemSchema),
});
export type GetFaceGroupAssetsResponse = z.infer<
  typeof getFaceGroupAssetsResponseSchema
>;

// ============================================================================
// INTEGRATIONS — the generic integration + per-provider account lists
// ============================================================================

/** An organization-integration row — the atom, verbatim. */
export const organizationIntegrationSchema = organizationIntegrationAtomSchema;
export type OrganizationIntegration = z.infer<
  typeof organizationIntegrationSchema
>;

/**
 * The simplified integration view returned by `GET /integrations`. A COMPUTED
 * shape (not the atom): typed `config` and a derived `status`.
 */
export const integrationSchema = z.object({
  id: z.string(),
  type: z.enum(integrationTypeValues),
  name: z.string(),
  status: z.enum(['active', 'inactive', 'error']),
  config: z.record(z.string(), z.unknown()),
  lastSyncAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Integration = z.infer<typeof integrationSchema>;

/** `GET /integrations` — `{ integrations, total }`. */
export const listIntegrationsResponseSchema = z.object({
  integrations: z.array(integrationSchema),
  total: z.number(),
});
export type ListIntegrationsResponse = z.infer<
  typeof listIntegrationsResponseSchema
>;

/**
 * A connected email account (computed provider view).
 *
 * `displayName`/`lastSyncAt`/`tokenExpiresAt` are raw nullable columns
 * (`packages/features/src/integrations/services/list-email-accounts/list-email-accounts.service.ts`
 * selects them straight through, no `?? undefined` fallback) — `.nullish()`
 * so a `null` value survives the interceptor's JSON round-trip (ENG-843).
 */
export const emailAccountSchema = z.object({
  id: z.string(),
  provider: z.enum(emailProviderValues),
  email: z.string(),
  displayName: z.string().nullish(),
  isActive: z.boolean(),
  lastSyncAt: z.string().nullish(),
  tokenExpiresAt: z.string().nullish(),
  createdAt: z.string(),
});
export type EmailAccount = z.infer<typeof emailAccountSchema>;

/** `GET /integrations/email/accounts` — `{ accounts }`. */
export const listEmailAccountsResponseSchema = z.object({
  accounts: z.array(emailAccountSchema),
});
export type ListEmailAccountsResponse = z.infer<
  typeof listEmailAccountsResponseSchema
>;

/**
 * A connected calendar account (computed provider view).
 *
 * `displayName`/`lastSyncAt`/`tokenExpiresAt` are raw nullable columns and
 * `connectedByName` a nullable `leftJoin` on `user`
 * (`packages/features/src/integrations/services/list-calendar-accounts/list-calendar-accounts.service.ts`
 * selects all four straight through, no `?? undefined` fallback) —
 * `.nullish()` so a `null` value survives the interceptor's JSON round-trip
 * (ENG-843).
 */
export const calendarAccountSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullish(),
  calendarId: z.string(),
  isActive: z.boolean(),
  syncEnabled: z.boolean(),
  lastSyncAt: z.string().nullish(),
  tokenExpiresAt: z.string().nullish(),
  createdAt: z.string(),
  connectedByName: z.string().nullish(),
});
export type CalendarAccount = z.infer<typeof calendarAccountSchema>;

/** `GET /integrations/calendar/accounts` — `{ accounts }`. */
export const listCalendarAccountsResponseSchema = z.object({
  accounts: z.array(calendarAccountSchema),
});
export type ListCalendarAccountsResponse = z.infer<
  typeof listCalendarAccountsResponseSchema
>;

/** A connected WhatsApp account (computed provider view). */
export const whatsAppAccountSchema = z.object({
  id: z.string(),
  phoneNumberId: z.string(),
  phoneNumber: z.string(),
  displayName: z.string().nullable(),
  isActive: z.boolean(),
  isVerified: z.boolean(),
  isChatbotActive: z.boolean(),
  connectedByName: z.string().nullable(),
  tokenExpiresAt: z.string().nullable(),
  tokenStatus: z.enum(['valid', 'needs_reconnect']),
  createdAt: z.string(),
});
export type WhatsAppAccount = z.infer<typeof whatsAppAccountSchema>;

/** `GET /integrations/whatsapp/accounts` — `{ accounts }`. */
export const listWhatsAppAccountsResponseSchema = z.object({
  accounts: z.array(whatsAppAccountSchema),
});
export type ListWhatsAppAccountsResponse = z.infer<
  typeof listWhatsAppAccountsResponseSchema
>;

/** A connected booking account (Calendly / Timely / Phorest / Fresha). */
export const bookingAccountSchema = z.object({
  id: z.string(),
  provider: z.enum(bookingProviderValues),
  externalAccountId: z.string().nullable(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  isActive: z.boolean(),
  lastSyncAt: z.string().nullable(),
  tokenExpiresAt: z.string().nullable(),
  createdAt: z.string(),
  connectedByName: z.string().nullable(),
});
export type BookingAccount = z.infer<typeof bookingAccountSchema>;

/** `GET /integrations/booking/accounts` — `{ accounts }`. */
export const listBookingAccountsResponseSchema = z.object({
  accounts: z.array(bookingAccountSchema),
});
export type ListBookingAccountsResponse = z.infer<
  typeof listBookingAccountsResponseSchema
>;

/**
 * A connected Meta Ads page as returned by `GET /integrations/meta-ads/pages`
 * (the `MetaAdsPageInfo` service shape). Standalone Instagram integrations are
 * folded in as virtual page entries, hence the `linkedInstagram*` fields.
 *
 * NOTE: this is a DIFFERENT shape from the pages nested on the integration
 * detail (`metaIntegrationPageSchema` below) — the two endpoints project
 * different columns.
 */
export const metaAdsPageSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  pageName: z.string().nullable(),
  platform: z.enum(['facebook', 'instagram']),
  pixelId: z.string().nullable(),
  pixelName: z.string().nullable(),
  defaultLeadFormId: z.string().nullable(),
  defaultLeadFormName: z.string().nullable(),
  linkedInstagramAccountId: z.string().nullable(),
  linkedInstagramUsername: z.string().nullable(),
  linkedInstagramName: z.string().nullable(),
  isChatbotActive: z.boolean(),
  isActive: z.boolean(),
  isDefault: z.boolean(),
  createdAt: z.string(),
});
export type MetaAdsPage = z.infer<typeof metaAdsPageSchema>;

/** `GET /integrations/meta-ads/pages` — `{ pages }`. */
export const listMetaAdsPagesResponseSchema = z.object({
  pages: z.array(metaAdsPageSchema),
});
export type ListMetaAdsPagesResponse = z.infer<
  typeof listMetaAdsPagesResponseSchema
>;

/**
 * A page nested on the Meta Ads integration detail (`MetaPageInfo`). Unlike the
 * list-pages shape it carries the page profile + default-ad-account columns and
 * omits the chatbot / isDefault fields.
 */
export const metaIntegrationPageSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  pageName: z.string().nullable(),
  pageUsername: z.string().nullable(),
  pagePictureUrl: z.string().nullable(),
  platform: z.enum(['facebook', 'instagram']),
  pixelId: z.string().nullable(),
  pixelName: z.string().nullable(),
  defaultLeadFormId: z.string().nullable(),
  defaultLeadFormName: z.string().nullable(),
  defaultAdAccountId: z.string().nullable(),
  defaultAdAccountName: z.string().nullable(),
  defaultAdAccountCurrency: z.string().nullable(),
  linkedInstagramAccountId: z.string().nullable(),
  linkedInstagramUsername: z.string().nullable(),
  linkedInstagramName: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type MetaIntegrationPage = z.infer<typeof metaIntegrationPageSchema>;

/**
 * Wizard option blobs (jsonb `$type<…Stored>`) surfaced only while the
 * integration is in `pending_selection` — otherwise null.
 */
export const metaBusinessInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  profilePictureUri: z.string().optional(),
});
export const metaAdAccountInfoSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  name: z.string(),
  currency: z.string(),
  accountStatus: z.number(),
  businessName: z.string().optional(),
  businessId: z.string().optional(),
});
export const metaPageInfoStoredSchema = z.object({
  id: z.string(),
  name: z.string(),
  accessToken: z.string(),
  category: z.string().optional(),
  pictureUrl: z.string().optional(),
  businessId: z.string().optional(),
  instagramBusinessAccount: z
    .object({
      id: z.string(),
      name: z.string(),
      username: z.string(),
      profilePictureUrl: z.string().optional(),
    })
    .optional(),
});

/**
 * A Meta Ads integration (`MetaIntegrationInfo`) with its connected pages,
 * default page, derived `tokenStatus`, the connecting user's profile, and the
 * wizard option blobs (populated only in `pending_selection`).
 */
export const metaAdsIntegrationSchema = z.object({
  id: z.string(),
  configurationStatus: z.enum(metaIntegrationStatusValues),
  adAccountId: z.string().nullable(),
  adAccountName: z.string().nullable(),
  defaultPageId: z.string().nullable(),
  isActive: z.boolean(),
  tokenStatus: z.enum(tokenStatusValues),
  connectedByName: z.string().nullable(),
  facebookUserName: z.string().nullable(),
  facebookUserEmail: z.string().nullable(),
  facebookUserPictureUrl: z.string().nullable(),
  tokenExpiresAt: z.string().nullable(),
  createdAt: z.string(),
  pages: z.array(metaIntegrationPageSchema),
  defaultPage: metaIntegrationPageSchema.nullable(),
  availableBusinesses: z.array(metaBusinessInfoSchema).nullable(),
  availableAdAccounts: z.array(metaAdAccountInfoSchema).nullable(),
  availablePages: z.array(metaPageInfoStoredSchema).nullable(),
});
export type MetaAdsIntegration = z.infer<typeof metaAdsIntegrationSchema>;

/** `GET /integrations/meta-ads` — the integration wrapper (null = none). */
export const getMetaIntegrationResponseSchema = z.object({
  integration: metaAdsIntegrationSchema.nullable(),
});
export type GetMetaIntegrationResponse = z.infer<
  typeof getMetaIntegrationResponseSchema
>;

/** A synced Meta lead form. */
export const metaLeadFormSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  locale: z.string().optional(),
  createdTime: z.string().optional(),
  pageId: z.string().optional(),
});
export type MetaLeadForm = z.infer<typeof metaLeadFormSchema>;

/** `GET /integrations/meta-ads/lead-forms` — `{ forms }`. */
export const listMetaLeadFormsResponseSchema = z.object({
  forms: z.array(metaLeadFormSchema),
});
export type ListMetaLeadFormsResponse = z.infer<
  typeof listMetaLeadFormsResponseSchema
>;

/** A connected Google My Business account. */
export const googleMyBusinessAccountSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  googleAccountEmail: z.string(),
  accountName: z.string(),
  locationId: z.string(),
  locationName: z.string(),
  placeId: z.string(),
  reviewLink: z.string(),
  averageRating: z.number().nullable(),
  /**
   * DB default is `0`, but the column has no `NOT NULL` — a raw update can
   * still leave it `null`, and the service selects it straight through
   * (`list-google-my-business-accounts.service.ts`). `.nullable()` so that
   * survives the interceptor's JSON round-trip (ENG-843).
   */
  totalReviews: z.number().nullable(),
  isActive: z.boolean(),
  lastSyncAt: z.string().nullable(),
  tokenExpiresAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GoogleMyBusinessAccount = z.infer<
  typeof googleMyBusinessAccountSchema
>;

/** `GET /integrations/google-business/accounts` — `{ accounts }`. */
export const listGoogleMyBusinessAccountsResponseSchema = z.object({
  accounts: z.array(googleMyBusinessAccountSchema),
});
export type ListGoogleMyBusinessAccountsResponse = z.infer<
  typeof listGoogleMyBusinessAccountsResponseSchema
>;

// ============================================================================
// INSTAGRAM
// ============================================================================

/**
 * An Instagram integration (computed connection view, not the atom): adds a
 * derived `tokenStatus` and the joined `connectedByName`.
 */
export const instagramIntegrationSchema = z.object({
  id: z.string(),
  instagramUserId: z.string().nullable(),
  username: z.string().nullable(),
  name: z.string().nullable(),
  profilePictureUrl: z.string().nullable(),
  accountType: z.string().nullable(),
  isActive: z.boolean(),
  chatbotEnabled: z.boolean(),
  tokenStatus: z.enum(['valid', 'needs_reconnect']),
  connectedByName: z.string().nullable(),
  tokenExpiresAt: z.string().nullable(),
  createdAt: z.string(),
});
export type InstagramIntegration = z.infer<typeof instagramIntegrationSchema>;

/** `GET /integrations/instagram` — the integration wrapper (null = none). */
export const getInstagramIntegrationResponseSchema = z.object({
  integration: instagramIntegrationSchema.nullable(),
});
export type GetInstagramIntegrationResponse = z.infer<
  typeof getInstagramIntegrationResponseSchema
>;

// ============================================================================
// STRIPE CONNECT (embedded onboarding status)
// ============================================================================

/** `GET /integrations/stripe/account-status` — the Connect account status. */
export const stripeConnectStatusSchema = z.object({
  connected: z.boolean(),
  accountType: z
    .enum(['standard_oauth', 'standard_linked', 'controller'])
    .nullable(),
  chargesEnabled: z.boolean(),
  payoutsEnabled: z.boolean(),
  detailsSubmitted: z.boolean(),
  requirementsCurrentlyDue: z.array(z.string()),
  disabledReason: z.string().nullable(),
});
export type StripeConnectStatus = z.infer<typeof stripeConnectStatusSchema>;

// ============================================================================
// SEQUENCES (projection-only — no wired hooks live under this domain's dirs;
// the sequence builder consumes these types via api-client)
// ============================================================================

/** A sequence (automation) row — the atom, verbatim. */
export const sequenceSchema = sequenceAtomSchema;
export type Sequence = z.infer<typeof sequenceSchema>;

// ============================================================================
// API KEYS (projection-only — no app hooks; developer settings surface)
// ============================================================================

/** An API key as returned by the list endpoint (the raw `key` is never exposed). */
export const apiKeyListItemSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  start: z.string().nullable(),
  prefix: z.string().nullable(),
  enabled: z.boolean(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  lastRequest: z.string().nullable(),
  scopes: z.array(z.string()),
  rateLimitMax: z.number().nullable(),
});
export type ApiKeyListItem = z.infer<typeof apiKeyListItemSchema>;

/** `GET /api-keys` — `{ items }`. */
export const apiKeyListResponseSchema = z.object({
  items: z.array(apiKeyListItemSchema),
});
export type ApiKeyListResponse = z.infer<typeof apiKeyListResponseSchema>;

/** `POST /api-keys` — the created key (the plaintext `key` is shown ONCE). */
export const createApiKeyResponseSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string().nullable(),
  expiresAt: z.string().nullable(),
  prefix: z.string().nullable(),
});
export type CreateApiKeyResponse = z.infer<typeof createApiKeyResponseSchema>;

/** The full `apikey` row atom (server-side; the plaintext key IS present). */
export const apiKeyRowSchema = apikeyAtomSchema;
export type ApiKeyRow = z.infer<typeof apiKeyRowSchema>;

// ============================================================================
// TRAINING HUB (projection-only — no wired hooks under this domain's dir)
// ============================================================================

/** A training video row — the atom, verbatim. */
export const trainingVideoSchema = trainingVideoAtomSchema;
export type TrainingVideo = z.infer<typeof trainingVideoSchema>;

/** A user's progress against a training video — the atom, verbatim. */
export const userVideoProgressSchema = userVideoProgressAtomSchema;
export type UserVideoProgress = z.infer<typeof userVideoProgressSchema>;

/** A training video with the current user's progress (joined projection). */
export const trainingVideoWithProgressSchema = trainingVideoAtomSchema.extend({
  progress: userVideoProgressSchema.nullable(),
});
export type TrainingVideoWithProgress = z.infer<
  typeof trainingVideoWithProgressSchema
>;
