// Re-export all types from api-client (single source of truth)
export type {
  Campaign,
  CampaignInsights,
  CampaignInsightsParams,
  CampaignInsightsSummary,
  CampaignInsightsTotals,
  CampaignObjective,
  CampaignStatus,
  CampaignTargeting,
  CreateCampaignInput,
  CreateCampaignResponse,
  ListCampaignInsightsResponse,
  ListCampaignsParams,
  ListCampaignsResponse,
  UpdateCampaignInput,
} from '@borradh-workspace/api-client/types';

// FollowUpType and ConversionDestination are re-exported from meta-ads in the barrel
export type {
  ConversionDestination,
  FollowUpType,
} from '@borradh-workspace/api-client/types';

export {
  metaCampaignObjectiveLabels,
  metaCampaignObjectiveValues,
  metaCampaignStatusLabels,
  metaCampaignStatusValues,
} from '@borradh-workspace/api-client/types';
