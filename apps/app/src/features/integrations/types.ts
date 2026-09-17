/**
 * Integrations Types
 *
 * Enum types are re-exported from @borradh-workspace/api-client/types (source of truth).
 * Frontend-specific interfaces (wizard flows, extended responses) are defined here.
 */

// Import types from api-client for local use in interfaces below
import type {
  BookingProvider as _BookingProvider,
  MetaAdAccountInfo as _MetaAdAccountInfo,
  MetaBusinessInfo as _MetaBusinessInfo,
} from '@borradh-workspace/api-client/types';

// Re-export enum types from api-client (derived from database labels)
export type {
  IntegrationType,
  IntegrationStatus,
  EmailProvider,
  BookingProvider,
} from '@borradh-workspace/api-client/types';

// Re-export labels and values for UI usage (dropdowns, badges, etc.)
export {
  integrationTypeLabels,
  integrationTypeValues,
  emailProviderLabels,
  emailProviderValues,
  bookingProviderLabels,
  bookingProviderValues,
} from '@borradh-workspace/api-client/types';

// Re-export shared entity types from api-client
export type {
  Integration,
  CreateIntegrationInput,
  UpdateIntegrationInput,
  TestIntegrationResponse,
  ListIntegrationsResponse,
  EmailAccount,
  ListEmailAccountsResponse,
  CalendarAccount,
  ListCalendarAccountsResponse,
  WhatsAppAccount,
  ListWhatsAppAccountsResponse,
  MetaBusinessInfo,
  MetaAdAccountInfo,
  MetaPageInfo,
  MetaAdsWizardSession,
  ConnectPhorestInput,
  ConnectPhorestResponse,
  MetaLeadForm,
  ListMetaLeadFormsResponse,
  GoogleMyBusinessAccount,
  ListGoogleMyBusinessAccountsResponse,
  GoogleReview,
  GetGoogleReviewLinkResponse,
  SyncGoogleReviewsResponse,
  InstagramIntegration,
  GetInstagramIntegrationResponse,
} from '@borradh-workspace/api-client/types';

// ============================================================================
// FRONTEND-SPECIFIC TYPES (wizard flows, extended responses)
// These types are used in the Meta Ads integration wizard and have
// additional fields not present in the api-client versions.
// ============================================================================

/**
 * Meta integration configuration status
 */
export type MetaIntegrationStatus = 'pending_selection' | 'configured';

/**
 * Token health status (shared by Meta Ads and Instagram integrations)
 */
export type TokenStatus = 'valid' | 'needs_reconnect';

/**
 * Stored page info (includes accessToken, used during pending_selection)
 */
export interface MetaPageInfoStored {
  id: string;
  name: string;
  accessToken: string;
  category?: string;
  pictureUrl?: string;
  businessId?: string;
  instagramBusinessAccount?: {
    id: string;
    name: string;
    username: string;
    profilePictureUrl?: string;
  };
}

/**
 * Meta page platform type
 */
export type MetaPagePlatform = 'facebook' | 'instagram';

/**
 * Meta Ads Page (frontend-extended version with isDefault)
 */
export interface MetaAdsPage {
  id: string;
  pageId: string;
  pageName: string | null;
  pageUsername: string | null;
  pagePictureUrl: string | null;
  platform: MetaPagePlatform;
  pixelId: string | null;
  pixelName: string | null;
  defaultLeadFormId: string | null;
  defaultLeadFormName: string | null;
  defaultAdAccountId: string | null;
  defaultAdAccountName: string | null;
  defaultAdAccountCurrency: string | null;
  linkedInstagramAccountId: string | null;
  linkedInstagramUsername: string | null;
  linkedInstagramName: string | null;
  isActive: boolean;
  isChatbotActive: boolean;
  isDefault: boolean;
  createdAt: string;
}

/**
 * Meta Ads Integration (frontend-extended version with wizard fields)
 */
export interface MetaAdsIntegration {
  id: string;
  configurationStatus: MetaIntegrationStatus;
  adAccountId: string | null;
  adAccountName: string | null;
  defaultPageId: string | null;
  isActive: boolean;
  tokenStatus: TokenStatus;
  connectedByName: string | null;
  facebookUserName: string | null;
  facebookUserEmail: string | null;
  facebookUserPictureUrl: string | null;
  tokenExpiresAt: string | null;
  /** Connected via Facebook Login for Business (non-expiring system-user token) */
  isFlfb?: boolean;
  createdAt: string;
  // Included in response from get-meta-integration
  pages?: MetaAdsPage[];
  defaultPage?: MetaAdsPage | null;
  // Available options for wizard (only populated when configurationStatus is 'pending_selection')
  availableBusinesses?: _MetaBusinessInfo[] | null;
  availableAdAccounts?: _MetaAdAccountInfo[] | null;
  availablePages?: MetaPageInfoStored[] | null;
}

export interface GetMetaIntegrationResponse {
  integration: MetaAdsIntegration | null;
}

export interface ListMetaAdsPagesResponse {
  pages: MetaAdsPage[];
}

export interface AddMetaAdsPageInput {
  code: string;
  pageId: string;
  pageName?: string;
  platform: MetaPagePlatform;
  pixelId?: string;
  pixelName?: string;
}

export interface AddMetaAdsPageResponse {
  page: MetaAdsPage;
}

export interface RemoveMetaAdsPageResponse {
  success: boolean;
}

export interface SetDefaultMetaAdsPageResponse {
  integration: MetaAdsIntegration;
}

/**
 * Configure Meta Integration (wizard completion) - multi-select
 */
export interface ConfigureMetaIntegrationInput {
  integrationId: string;
  adAccountIds: string[];
  pageIds: string[];
}

export interface ConfigureMetaIntegrationResponse {
  success: boolean;
  integration: MetaAdsIntegration;
  pages: MetaAdsPage[];
}

/**
 * Booking account type (frontend-extended with total)
 */
export interface BookingAccount {
  id: string;
  provider: _BookingProvider;
  externalAccountId: string | null;
  email: string | null;
  displayName: string | null;
  isActive: boolean;
  lastSyncAt: string | null;
  tokenExpiresAt: string | null;
  createdAt: string;
  connectedByName: string | null;
}

export interface ListBookingAccountsResponse {
  accounts: BookingAccount[];
}
