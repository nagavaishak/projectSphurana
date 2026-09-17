/**
 * @borradh-workspace/api-client - Social Posts API Types
 *
 * Types for the social posts API endpoints.
 * Types are derived from backend packages - database enums and types.
 */

// Import types from features/shared (isolatedModules compliant - separate imports)
import type {
  PlatformPublishResult as BackendPlatformPublishResult,
  PlatformSettings as BackendPlatformSettings,
  SocialPost as BackendSocialPost,
  SocialPlatform,
  SocialPostMediaType,
  SocialPostStatus,
} from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  socialPlatformLabels,
  socialPlatformValues,
  socialPostMediaTypeLabels,
  socialPostMediaTypeValues,
  socialPostStatusLabels,
  socialPostStatusValues,
} from '@borradh-workspace/features/shared';

import type { Serialize } from './serialization.js';
import type { PaginatedResponse, PaginationParams } from './shared.js';

// ============================================================================
// ENUM TYPES - Re-exported from database (Labels pattern)
// ============================================================================

/**
 * Social post status type - re-exported from database
 */
export type { SocialPostStatus };

/**
 * Social post media type - re-exported from database
 */
export type { SocialPostMediaType };

/**
 * Social platform type - re-exported from database
 * Note: Using alias to maintain backwards compatibility
 */
export type SocialPostPlatform = SocialPlatform;

/**
 * Labels and values for UI usage (dropdowns, badges, etc.)
 */
export {
  socialPostStatusLabels,
  socialPostStatusValues,
  socialPostMediaTypeLabels,
  socialPostMediaTypeValues,
  socialPlatformLabels,
  socialPlatformValues,
};

// ============================================================================
// SHARED TYPES - Re-exported from database
// ============================================================================

/**
 * Platform-specific settings
 */
export type PlatformSettings = BackendPlatformSettings;

/**
 * Platform publish result
 */
export type PlatformPublishResult = BackendPlatformPublishResult;

// ============================================================================
// ENTITY TYPES - Serialized for API responses (Date → string)
// ============================================================================

/**
 * Social post entity (API response - dates serialized to ISO strings)
 */
export type SocialPost = Serialize<BackendSocialPost>;

// ============================================================================
// RESPONSE TYPES - API-specific shapes
// ============================================================================

/**
 * List social posts response
 */
export interface ListSocialPostsResponse
  extends PaginatedResponse<SocialPost> {}

// ============================================================================
// INPUT TYPES - Frontend input shapes (no backend schema)
// ============================================================================

/**
 * Create social post input
 *
 * Supports two modes:
 * 1. `platforms` + optional `platformSettings` - direct platform specification
 * 2. `pageIds` - derive platforms from connected Meta Ads pages
 *
 * At least one of `platforms` or `pageIds` must be provided.
 */
export interface CreateSocialPostInput {
  title: string;
  caption?: string;
  mediaType: SocialPostMediaType;
  mediaUrl: string;
  /** Ordered media URLs for a multi-image carousel (2+ entries). The first
   *  entry should match `mediaUrl`. Omit for single-image/video posts. */
  mediaUrls?: string[];
  thumbnailUrl?: string;
  videoId?: string;
  /** Link to source graphic (for graphics created in editor) */
  graphicId?: string;
  /** Direct platform specification */
  platforms?: SocialPostPlatform[];
  /** Alternative: Meta Ads page IDs (platforms derived from these) */
  pageIds?: string[];
  platformSettings?: PlatformSettings;
  scheduledAt?: string;
}

/**
 * Update social post input
 */
export interface UpdateSocialPostInput {
  title?: string;
  caption?: string | null;
  mediaType?: SocialPostMediaType;
  mediaUrl?: string;
  thumbnailUrl?: string | null;
  videoId?: string | null;
  platforms?: SocialPostPlatform[];
  platformSettings?: PlatformSettings;
  scheduledAt?: string | null;
  status?: 'draft' | 'scheduled';
}

/**
 * List social posts filters
 */
export interface ListSocialPostsFilters extends PaginationParams {
  status?: SocialPostStatus;
  platform?: SocialPostPlatform;
  mediaType?: SocialPostMediaType;
  startDate?: string;
  endDate?: string;
  search?: string;
}
