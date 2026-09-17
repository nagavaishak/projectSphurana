/**
 * @borradh-workspace/api-client - Integrations API Types
 *
 * Types for the integrations API endpoints.
 * Types are derived from backend packages - database enums.
 */

// Import types from features/shared (isolatedModules compliant - separate imports)
import type {
  OrganizationIntegration as BackendOrganizationIntegration,
  BookingProvider,
  EmailProvider,
  IntegrationType,
} from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  bookingProviderLabels,
  bookingProviderValues,
  emailProviderLabels,
  emailProviderValues,
  integrationTypeLabels,
  integrationTypeValues,
} from '@borradh-workspace/features/shared';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES - Re-exported from database (Labels pattern)
// ============================================================================

/**
 * Integration type - re-exported from database
 */
export type { IntegrationType };

/**
 * Email provider type - re-exported from database
 */
export type { EmailProvider };

/**
 * Booking provider type - re-exported from database
 */
export type { BookingProvider };

/**
 * Labels and values for UI usage (dropdowns, badges, etc.)
 */
export {
  integrationTypeLabels,
  integrationTypeValues,
  emailProviderLabels,
  emailProviderValues,
  bookingProviderLabels,
  bookingProviderValues,
};

/**
 * Integration status enum
 * Note: This is not a pgEnum in database, keeping as local type
 */
export type IntegrationStatus = 'active' | 'inactive' | 'error';

// ============================================================================
// ENTITY TYPES - Serialized for API responses (Date → string)
// ============================================================================

/**
 * Organization integration entity (API response - dates serialized to ISO strings)
 */
export type OrganizationIntegration = Serialize<BackendOrganizationIntegration>;

/**
 * Integration entity (simplified view for API responses)
 */
export interface Integration {
  id: string;
  type: IntegrationType;
  name: string;
  status: IntegrationStatus;
  config: Record<string, unknown>;
  lastSyncAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// RESPONSE TYPES - API-specific shapes
// ============================================================================

/**
 * Test integration response
 */
export interface TestIntegrationResponse {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * List integrations response
 */
export interface ListIntegrationsResponse {
  integrations: Integration[];
  total: number;
}

// ============================================================================
// INPUT TYPES - Frontend input shapes (no backend schema)
// ============================================================================

/**
 * Create integration input
 */
export interface CreateIntegrationInput {
  type: IntegrationType;
  name: string;
  config: Record<string, unknown>;
}

/**
 * Update integration input
 */
export interface UpdateIntegrationInput {
  name?: string;
  config?: Record<string, unknown>;
  status?: IntegrationStatus;
}

// ============================================================================
// EMAIL ACCOUNT TYPES
// ============================================================================

/**
 * Email account entity
 */
export interface EmailAccount {
  id: string;
  provider: EmailProvider;
  email: string;
  displayName?: string | null;
  isActive: boolean;
  lastSyncAt?: string | null;
  tokenExpiresAt?: string | null;
  createdAt: string;
}

/**
 * List email accounts response
 */
export interface ListEmailAccountsResponse {
  accounts: EmailAccount[];
}

// ============================================================================
// CALENDAR ACCOUNT TYPES
// ============================================================================

/**
 * Calendar account entity
 */
export interface CalendarAccount {
  id: string;
  email: string;
  displayName?: string | null;
  calendarId: string;
  isActive: boolean;
  syncEnabled: boolean;
  lastSyncAt?: string | null;
  tokenExpiresAt?: string | null;
  createdAt: string;
  connectedByName?: string | null;
}

/**
 * List calendar accounts response
 */
export interface ListCalendarAccountsResponse {
  accounts: CalendarAccount[];
}

// ============================================================================
// WHATSAPP TYPES
// ============================================================================

/**
 * WhatsApp account entity
 */
export interface WhatsAppAccount {
  id: string;
  phoneNumberId: string;
  phoneNumber: string;
  displayName: string | null;
  isActive: boolean;
  isVerified: boolean;
  isChatbotActive: boolean;
  connectedByName: string | null;
  tokenExpiresAt: string | null;
  tokenStatus: 'valid' | 'needs_reconnect';
  createdAt: string;
}

/**
 * List WhatsApp accounts response
 */
export interface ListWhatsAppAccountsResponse {
  accounts: WhatsAppAccount[];
}

// ============================================================================
// META ADS TYPES
// ============================================================================

/**
 * Meta ads page entity (connected Facebook/Instagram page)
 */
export interface MetaAdsPage {
  id: string;
  pageId: string;
  pageName: string | null;
  platform: 'facebook' | 'instagram';
  pixelId: string | null;
  pixelName: string | null;
  defaultLeadFormId: string | null;
  defaultLeadFormName: string | null;
  isActive: boolean;
  lastSyncAt: string | null;
  createdAt: string;
}

/**
 * Meta ads integration entity
 */
export interface MetaAdsIntegration {
  id: string;
  adAccountId: string;
  adAccountName: string | null;
  isActive: boolean;
  connectedByName: string | null;
  tokenExpiresAt: string | null;
  /** Connected via Facebook Login for Business (non-expiring system-user token) */
  isFlfb?: boolean;
  createdAt: string;
  /** All connected pages for this integration */
  pages: MetaAdsPage[];
  /** The default page (convenience accessor) */
  defaultPage: MetaAdsPage | null;
}

/**
 * Get Meta integration response
 */
export interface GetMetaIntegrationResponse {
  integration: MetaAdsIntegration | null;
}

/**
 * Meta business info (from API)
 */
export interface MetaBusinessInfo {
  id: string;
  name: string;
  profilePictureUri?: string;
}

/**
 * Meta ad account info (from API)
 */
export interface MetaAdAccountInfo {
  id: string;
  accountId: string;
  name: string;
  currency: string;
  /** 1=Active, 2=Disabled, 3=Unsettled, 7=Pending Review, 9=Grace Period, 101=Closed */
  accountStatus: number;
  businessName?: string;
  /** Business ID this ad account belongs to */
  businessId?: string;
  disableReason?: number;
  hasPaymentMethod?: boolean;
}

/**
 * Meta page info (from API)
 */
export interface MetaPageInfo {
  id: string;
  name: string;
  category?: string;
  pictureUrl?: string;
}

/**
 * Meta ads wizard session data (from OAuth callback)
 */
export interface MetaAdsWizardSession {
  organizationId: string;
  userId: string;
  accessToken: string;
  expiresIn: number;
  adAccounts: MetaAdAccountInfo[];
  pages: MetaPageInfo[];
}

// ============================================================================
// BOOKING ACCOUNT TYPES (Calendly, Timely, Phorest, Fresha)
// ============================================================================

/**
 * Booking account entity
 */
export interface BookingAccount {
  id: string;
  provider: BookingProvider;
  externalAccountId: string | null;
  email: string | null;
  displayName: string | null;
  isActive: boolean;
  lastSyncAt: string | null;
  tokenExpiresAt: string | null;
  createdAt: string;
  connectedByName: string | null;
}

/**
 * List booking accounts response
 */
export interface ListBookingAccountsResponse {
  accounts: BookingAccount[];
}

/**
 * Connect Phorest input
 */
export interface ConnectPhorestInput {
  username: string;
  password: string;
  businessId: string;
  region?: 'eu' | 'us';
}

/**
 * Connect Phorest response
 */
export interface ConnectPhorestResponse {
  success: boolean;
  account: BookingAccount;
}

// ============================================================================
// GOOGLE MY BUSINESS TYPES
// ============================================================================

/**
 * Google My Business account entity
 */
export interface GoogleMyBusinessAccount {
  id: string;
  organizationId: string;
  googleAccountEmail: string;
  accountName: string;
  locationId: string;
  locationName: string;
  placeId: string;
  reviewLink: string;
  averageRating: number | null;
  totalReviews: number | null;
  isActive: boolean;
  lastSyncAt: string | null;
  tokenExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * List Google My Business accounts response
 */
export interface ListGoogleMyBusinessAccountsResponse {
  accounts: GoogleMyBusinessAccount[];
}

/**
 * Google review entity
 */
export interface GoogleReview {
  id: string;
  googleMyBusinessAccountId: string;
  reviewId: string;
  reviewerName: string;
  reviewerPhotoUrl: string | null;
  rating: number;
  comment: string | null;
  replyComment: string | null;
  repliedAt: string | null;
  publishedAt: string;
  createdAt: string;
}

/**
 * Get review link response
 */
export interface GetGoogleReviewLinkResponse {
  reviewLink: string;
  locationName: string;
  placeId: string;
  averageRating: number | null;
  totalReviews: number;
}

/**
 * Sync Google reviews response
 */
export interface SyncGoogleReviewsResponse {
  synced: number;
  averageRating: number | null;
  totalReviews: number;
}

// ============================================================================
// META LEAD FORM TYPES
// ============================================================================

/**
 * Meta lead form (synced from Meta API)
 */
export interface MetaLeadForm {
  id: string;
  name: string;
  status: string;
  locale?: string;
  createdTime?: string;
  pageId?: string;
}

/**
 * List Meta lead forms response
 */
export interface ListMetaLeadFormsResponse {
  forms: MetaLeadForm[];
}

// ============================================================================
// EMBEDDED STRIPE CONNECT (contract §7.A)
// ============================================================================

/** GET /integrations/stripe/account-status response. */
export interface StripeConnectStatus {
  connected: boolean;
  accountType: 'standard_oauth' | 'standard_linked' | 'controller' | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsCurrentlyDue: string[];
  disabledReason: string | null;
}

/** POST /integrations/stripe/account-session response. */
export interface StripeAccountSessionResponse {
  clientSecret: string;
}

/** POST /integrations/stripe/account-session input. */
export interface CreateStripeAccountSessionInput {
  components?: string[];
}

/** POST /integrations/stripe/account-link input (hosted onboarding redirect). */
export interface CreateStripeAccountLinkInput {
  /** Where Stripe returns the user once onboarding is submitted. */
  returnUrl: string;
  /** Where Stripe sends the user if the link expires or is revisited. */
  refreshUrl: string;
}

/** POST /integrations/stripe/link-account input. */
export interface LinkStripeAccountInput {
  /** Stripe connected account id, e.g. `acct_1A2b3C4d5E6f7G8h`. */
  stripeAccountId: string;
}

/** POST /integrations/stripe/account-link response. */
export interface StripeAccountLinkResponse {
  url: string;
  expiresAt: number;
}
