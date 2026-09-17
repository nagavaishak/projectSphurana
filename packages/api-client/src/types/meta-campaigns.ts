/**
 * @borradh-workspace/api-client - Meta Campaigns API Types
 *
 * Campaigns are now fetched live from Meta API. No local storage.
 * Types are derived from backend packages.
 */

// Import types from features/shared (isolatedModules compliant - separate imports)
import type {
  MetaCampaignObjective,
  MetaCampaignStatus,
  MetaTargeting,
} from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  metaCampaignObjectiveLabels,
  metaCampaignObjectiveValues,
  metaCampaignStatusLabels,
  metaCampaignStatusValues,
} from '@borradh-workspace/features/shared';

// Import backend input types from features
import type {
  CreateCampaignInput as BackendCreateCampaignInput,
  ListCampaignsInput as BackendListCampaignsInput,
  UpdateCampaignInput as BackendUpdateCampaignInput,
} from '@borradh-workspace/features/meta-campaigns';

// Import feature response types
import type {
  CampaignInsights as BackendCampaignInsights,
  CampaignInsightsSummary as BackendCampaignInsightsSummary,
  CampaignListEntry as BackendCampaignListEntry,
  CreateCampaignResponse as BackendCreateCampaignResponse,
  ListCampaignsInsightsData as BackendListCampaignsInsightsData,
} from '@borradh-workspace/features/meta-campaigns';

// ============================================================================
// ENUM TYPES - Re-exported from database (Labels pattern)
// ============================================================================

export type CampaignStatus = MetaCampaignStatus;
export type CampaignObjective = MetaCampaignObjective;

export {
  metaCampaignStatusLabels,
  metaCampaignStatusValues,
  metaCampaignObjectiveLabels,
  metaCampaignObjectiveValues,
};

// ============================================================================
// SHARED TYPES - Re-exported from database
// ============================================================================

export type CampaignTargeting = MetaTargeting;

// ============================================================================
// ENTITY TYPES - Campaigns are now from Meta API (no local DB entity)
// ============================================================================

/**
 * Campaign from Meta API with ad count enrichment
 * id is now the Meta campaign ID (e.g., "23850123456")
 */
export type Campaign = BackendCampaignListEntry;

// ============================================================================
// RESPONSE TYPES - API-specific shapes
// ============================================================================

/**
 * List campaigns response - campaigns from Meta API
 */
export interface ListCampaignsResponse {
  campaigns: Campaign[];
}

/**
 * Create campaign response - Meta campaign + ad set IDs
 *
 * `location` is widened to OPTIONAL, which is the one place this type is
 * deliberately looser than the backend interface it derives from.
 *
 * The service does always send it — `resolveCampaignLocation` hard-returns on
 * failure, so there is exactly one success path and it always carries a branch.
 * The reason the client must not rely on that is DEPLOY ORDER: web ships
 * automatically on merge, while api and worker are manual `workflow_dispatch`,
 * so there is a window where a new frontend is talking to an API that predates
 * the field. `createMetaCampaignResponseSchema` marks it `.optional()` for the
 * same reason, and this type has to agree with the validator that actually
 * parses the response — a required type over a tolerant schema is a lie the
 * compiler cannot catch and the runtime will not raise.
 *
 * Read it defensively (`if (campaign.location)`), the way the assistant's
 * create-campaign tool already does.
 */
export type CreateCampaignResponse = Omit<
  BackendCreateCampaignResponse,
  'location'
> & {
  location?: BackendCreateCampaignResponse['location'];
};

/**
 * Campaign insights response from Meta API
 */
export type CampaignInsights = BackendCampaignInsights;

/**
 * Aggregated totals for campaign insights
 */
export type CampaignInsightsTotals = CampaignInsights['totals'];

/**
 * Insights for a single campaign within the batched response
 */
export type CampaignInsightsSummary = BackendCampaignInsightsSummary;

/**
 * Batched campaign insights response — insights for every campaign in the
 * org's ad account, fetched with a single Meta API call. Returned by
 * `GET /meta-campaigns/insights`.
 */
export type ListCampaignInsightsResponse = BackendListCampaignsInsightsData;

// ============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// ============================================================================

/**
 * List campaigns query params
 * Omits organizationId (added by controller from session)
 */
export type ListCampaignsParams = Omit<
  BackendListCampaignsInput,
  'organizationId'
>;

/**
 * Create campaign input
 * Omits organizationId (added by controller from session)
 * followUpType has server default so it's optional for API input
 * Backend resolves adAccountId via three-tier chain from metaAdsPageId
 */
export type CreateCampaignInput = Omit<
  BackendCreateCampaignInput,
  'organizationId' | 'followUpType'
> &
  Partial<Pick<BackendCreateCampaignInput, 'followUpType'>>;

/**
 * Update campaign input
 * Omits metaCampaignId, organizationId (metaCampaignId from route param, organizationId from session)
 */
export type UpdateCampaignInput = Omit<
  BackendUpdateCampaignInput,
  'metaCampaignId' | 'organizationId'
>;

/**
 * Parameters for fetching campaign insights
 * API accepts flat since/until query params (controller restructures for service's dateRange)
 */
export interface CampaignInsightsParams {
  since?: string;
  until?: string;
}
