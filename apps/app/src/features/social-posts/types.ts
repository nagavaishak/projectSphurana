/**
 * Social Posts Types
 *
 * Re-exports from @borradh-workspace/api-client/types following the type-sharing pattern.
 * See: .claude/rules/_patterns/type-sharing.md
 *
 * DO NOT define types here - import from api-client to ensure type consistency.
 */

// Enum types
export type {
  SocialPostStatus,
  SocialPostPlatform,
  SocialPostMediaType,
  PlatformSettings,
  PlatformPublishResult,
} from '@borradh-workspace/api-client/types';

// Entity types
export type { SocialPost } from '@borradh-workspace/api-client/types';

// Response types
export type { ListSocialPostsResponse } from '@borradh-workspace/api-client/types';

// Input types
export type {
  CreateSocialPostInput,
  UpdateSocialPostInput,
  ListSocialPostsFilters,
} from '@borradh-workspace/api-client/types';

// Labels and values for UI components (dropdowns, badges, etc.)
export {
  socialPostStatusLabels,
  socialPostStatusValues,
  socialPostMediaTypeLabels,
  socialPostMediaTypeValues,
  socialPlatformLabels,
  socialPlatformValues,
} from '@borradh-workspace/api-client/types';
