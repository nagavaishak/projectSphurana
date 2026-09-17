// Create campaign
export {
  createCampaign,
  createCampaignSchema,
  type CreateCampaignInput,
  type CreateCampaignResult,
  type CreateCampaignResponse,
} from './create-campaign/index.js';

// List campaigns
export {
  listCampaigns,
  listCampaignsSchema,
  type ListCampaignsInput,
  type ListCampaignsResult,
  type CampaignListEntry,
} from './list-campaigns/index.js';

// Delete campaign
export {
  deleteCampaign,
  deleteCampaignSchema,
  type DeleteCampaignInput,
  type DeleteCampaignResult,
} from './delete-campaign/index.js';

// Duplicate campaign (deep copy via Meta /copies edge — runs in the worker)
export {
  duplicateCampaign,
  duplicateCampaignSchema,
  type DuplicateCampaignInput,
  type DuplicateCampaignResult,
  type DuplicateCampaignResponse,
} from './duplicate-campaign/index.js';

// Queue producer for backgrounded campaign duplication
export {
  queueDuplicateCampaign,
  closeDuplicateCampaignQueue,
  META_CAMPAIGN_DUPLICATE_QUEUE,
  queueDuplicateCampaignSchema,
  type QueueDuplicateCampaignInput,
  type QueueDuplicateCampaignResult,
  type DuplicateCampaignJobPayload,
} from './queue-duplicate-campaign/index.js';

// Pause campaign
export {
  pauseCampaign,
  pauseCampaignSchema,
  type PauseCampaignInput,
  type PauseCampaignResult,
} from './pause-campaign/index.js';

// Resume campaign
export {
  resumeCampaign,
  resumeCampaignSchema,
  type ResumeCampaignInput,
  type ResumeCampaignResult,
} from './resume-campaign/index.js';

// Update campaign
export {
  updateCampaign,
  updateCampaignSchema,
  type UpdateCampaignInput,
  type UpdateCampaignResult,
} from './update-campaign/index.js';

// Get campaign insights
export {
  getCampaignInsights,
  getCampaignInsightsSchema,
  type GetCampaignInsightsInput,
  type GetCampaignInsightsResult,
  type CampaignInsights,
} from './get-campaign-insights/index.js';

// List campaigns insights (batched — one Meta call for every campaign)
export {
  listCampaignsInsights,
  listCampaignsInsightsSchema,
  type ListCampaignsInsightsInput,
  type ListCampaignsInsightsResult,
  type ListCampaignsInsightsData,
  type CampaignInsightsSummary,
  type CampaignInsightsTotals,
} from './list-campaigns-insights/index.js';

// Get campaign learning status (W-C05 — backs the Claire learning-phase
// hard-block validators and is reusable by any UI that wants to know if a
// campaign is still inside Meta's learning window).
export {
  getCampaignLearningStatus,
  getCampaignLearningStatusSchema,
  type GetCampaignLearningStatusInput,
  type GetCampaignLearningStatusResult,
  type CampaignLearningStatus,
} from './get-campaign-learning-status/index.js';

// Campaign ad-account currency (drives the SERVER-derived budget display on
// the ad tools — the model no longer authors the money string; register #82).
export {
  getCampaignCurrency,
  getCampaignCurrencySchema,
  type GetCampaignCurrencyInput,
  type GetCampaignCurrencyResult,
  type CampaignCurrency,
} from './get-campaign-currency/index.js';

// Sync campaign insights
export {
  syncCampaignInsights,
  syncCampaignInsightsSchema,
  type SyncCampaignInsightsInput,
  type SyncCampaignInsightsResult,
  type SyncResult as CampaignInsightsSyncResult,
} from './sync-campaign-insights/index.js';
