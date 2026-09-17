// Re-export all types from api-client (single source of truth)
export type {
  Ad,
  AdPlacement,
  AdService,
  AdStatus,
  AdVideo,
  CallToAction,
  ConversionDestination,
  CreateAdInput,
  FollowUpType,
  ImportAdsResponse,
  LaunchAdFromPostInput,
  LaunchAdFromPostResponse,
  LaunchAdInput,
  LaunchAdResponse,
  ListAdsParams,
  ListAdsResponse,
  SyncAdResponse,
  UpdateAdInput,
} from '@borradh-workspace/api-client/types';

// Re-export campaign types for convenience (from meta-campaigns via barrel)
export type {
  CampaignObjective,
  CampaignTargeting,
} from '@borradh-workspace/api-client/types';

export {
  adPlacementLabels,
  adPlacementValues,
  conversionDestinationLabels,
  conversionDestinationValues,
  followUpTypeLabels,
  followUpTypeValues,
  metaAdStatusLabels,
  metaAdStatusValues,
  metaCallToActionLabels,
  metaCallToActionValues,
} from '@borradh-workspace/api-client/types';
