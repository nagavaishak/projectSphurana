/**
 * @borradh-workspace/api-client - Meta Ads API Types
 *
 * Types for the Meta ads API endpoints.
 * Types are derived from backend packages - database enums and features schemas.
 */

// Import types from features/shared (isolatedModules compliant - separate imports)
import type {
  AdPlacement as BackendAdPlacement,
  ConversionDestination as BackendConversionDestination,
  FollowUpType as BackendFollowUpType,
  MessagingDestination as BackendMessagingDestination,
  MetaAd as BackendMetaAd,
  MetaAdService as BackendMetaAdService,
  MetaAdStatus,
  MetaCallToAction,
} from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  adPlacementLabels,
  adPlacementValues,
  conversionDestinationLabels,
  conversionDestinationValues,
  followUpTypeLabels,
  followUpTypeValues,
  messagingDestinationLabels,
  messagingDestinationValues,
  metaAdStatusLabels,
  metaAdStatusValues,
  metaCallToActionLabels,
  metaCallToActionValues,
} from '@borradh-workspace/features/shared';

// Import backend input types from features
import type {
  CreateAdInput as BackendCreateAdInput,
  LaunchAdFromPostInput as BackendLaunchAdFromPostInput,
  LaunchAdFromPostResponse as BackendLaunchAdFromPostResponse,
  LaunchAdInput as BackendLaunchAdInput,
  LaunchAdResponse as BackendLaunchAdResponse,
  ListAdsInput as BackendListAdsInput,
  ReplaceAdCreativeInput as BackendReplaceAdCreativeInput,
  UpdateAdInput as BackendUpdateAdInput,
} from '@borradh-workspace/features/meta-ads';

import type { CampaignObjective, CampaignTargeting } from './meta-campaigns.js';
import type { Serialize } from './serialization.js';

// Re-export campaign types for convenience
export type { CampaignObjective, CampaignTargeting };

// ============================================================================
// ENUM TYPES - Re-exported from database (Labels pattern)
// ============================================================================

export type AdStatus = MetaAdStatus;
export type CallToAction = MetaCallToAction;
export type FollowUpType = BackendFollowUpType;
export type AdPlacement = BackendAdPlacement;
export type ConversionDestination = BackendConversionDestination;
export type MessagingDestination = BackendMessagingDestination;

export {
  metaAdStatusLabels,
  metaAdStatusValues,
  metaCallToActionLabels,
  metaCallToActionValues,
  followUpTypeLabels,
  followUpTypeValues,
  adPlacementLabels,
  adPlacementValues,
  conversionDestinationLabels,
  conversionDestinationValues,
  messagingDestinationLabels,
  messagingDestinationValues,
};

// ============================================================================
// ENTITY TYPES - Serialized for API responses (Date → string)
// ============================================================================

/**
 * Video reference for ads
 */
export interface AdVideo {
  id: string;
  title: string | null;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  duration: number | null;
  /**
   * Intrinsic size, set for asset-backed creatives (uploaded media stores its
   * own dimensions). Lets the preview frame take the creative's shape on first
   * paint instead of after the media loads.
   */
  width?: number | null;
  height?: number | null;
}

/**
 * Ad entity (API response - dates serialized to ISO strings)
 * callToAction is non-null (DB column has default 'LEARN_MORE')
 * targetingOverride excludes 'string' union (Drizzle jsonb adds it)
 */
export type Ad = Omit<
  Serialize<BackendMetaAd>,
  'callToAction' | 'targetingOverride'
> & {
  callToAction: CallToAction;
  targetingOverride: CampaignTargeting | null;
  video?: AdVideo;
  /** Full-res rendered image for graphic (image) ads, signed for the browser. */
  graphicImageUrl?: string | null;
  /**
   * Intrinsic size of `graphicImageUrl`. The preview frame uses it to take the
   * creative's shape on first paint rather than after the image loads.
   */
  graphicImageWidth?: number | null;
  graphicImageHeight?: number | null;
  services?: { id: string; name: string }[];
};

/**
 * Ad-Service junction (API response - dates serialized to ISO strings)
 */
export type AdService = Serialize<BackendMetaAdService>;

// ============================================================================
// RESPONSE TYPES - API-specific shapes
// ============================================================================

/**
 * List ads response
 */
export interface ListAdsResponse {
  ads: Ad[];
  total: number;
}

/**
 * Launch ad response - ad + Meta campaign/ad set IDs
 * Reuses the serialized `Ad` entity (backend nests `metaAd.$inferSelect`, whose
 * Date columns arrive as ISO strings on the wire).
 */
export type LaunchAdResponse = Omit<BackendLaunchAdResponse, 'ad'> & {
  ad: Ad;
};

/**
 * Sync ad response
 */
export interface SyncAdResponse {
  ad: Ad;
  synced: boolean;
}

/**
 * Import ads from Meta response
 */
export interface ImportAdsResponse {
  imported: number;
  skipped: number;
  total: number;
}

// ============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// ============================================================================

/**
 * List ads query params
 * Omits organizationId (added by controller from session)
 * limit/offset have server defaults so they're optional for API input
 */
export type ListAdsParams = Omit<
  BackendListAdsInput,
  'organizationId' | 'limit' | 'offset'
> &
  Partial<Pick<BackendListAdsInput, 'limit' | 'offset'>>;

/**
 * Create ad input (draft)
 * Omits organizationId (added by controller from session)
 * callToAction, followUpType, adPlacement have server defaults so they're optional for API input
 */
export type CreateAdInput = Omit<
  BackendCreateAdInput,
  'organizationId' | 'callToAction' | 'followUpType' | 'adPlacement'
> &
  Partial<
    Pick<BackendCreateAdInput, 'callToAction' | 'followUpType' | 'adPlacement'>
  >;

/**
 * Update ad input
 * Omits adId, organizationId (adId from route param, organizationId from session)
 */
export type UpdateAdInput = Omit<
  BackendUpdateAdInput,
  'adId' | 'organizationId'
>;

/** Replace exactly one creative on an unpublished local draft ad. */
export type ReplaceAdCreativeInput = Omit<
  BackendReplaceAdCreativeInput,
  'adId' | 'organizationId'
>;

/**
 * Launch ad input (create + publish in one step)
 * Requires an existing campaign — inline campaign creation is no longer supported.
 * Omits organizationId (added by controller from session)
 * callToAction, followUpType, adPlacement have server defaults so they're optional for API input
 */
export type LaunchAdInput = Omit<
  BackendLaunchAdInput,
  'organizationId' | 'callToAction' | 'followUpType' | 'adPlacement'
> &
  Partial<
    Pick<BackendLaunchAdInput, 'callToAction' | 'followUpType' | 'adPlacement'>
  >;

/**
 * Launch ad from existing post response
 * Reuses the serialized `Ad` entity (backend nests `metaAd.$inferSelect`, whose
 * Date columns arrive as ISO strings on the wire).
 */
export type LaunchAdFromPostResponse = Omit<
  BackendLaunchAdFromPostResponse,
  'ad'
> & {
  ad: Ad;
};

/**
 * Launch ad from existing post input (boost post)
 * Omits organizationId (added by controller from session)
 * followUpType, adPlacement have server defaults so they're optional for API input
 */
export type LaunchAdFromPostInput = Omit<
  BackendLaunchAdFromPostInput,
  'organizationId' | 'followUpType' | 'adPlacement'
> &
  Partial<Pick<BackendLaunchAdFromPostInput, 'followUpType' | 'adPlacement'>>;
