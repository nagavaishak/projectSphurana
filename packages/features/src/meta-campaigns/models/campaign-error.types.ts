/**
 * Campaign-specific error codes
 */
export const CampaignErrorCodes = {
  /** Campaign not found */
  CAMPAIGN_NOT_FOUND: 'CAMPAIGN_NOT_FOUND',
  /** Campaign is not in a valid state for the operation */
  INVALID_CAMPAIGN_STATE: 'INVALID_CAMPAIGN_STATE',
  /** Meta integration not configured */
  META_NOT_CONFIGURED: 'META_NOT_CONFIGURED',
  /** Failed to sync with Meta */
  META_SYNC_FAILED: 'META_SYNC_FAILED',
  /** Campaign has no ads to publish */
  NO_ADS_TO_PUBLISH: 'NO_ADS_TO_PUBLISH',
  /** Budget is required for publishing */
  BUDGET_REQUIRED: 'BUDGET_REQUIRED',
  /** Token no longer has access to the configured Facebook Page */
  META_PAGE_NOT_ACCESSIBLE: 'META_PAGE_NOT_ACCESSIBLE',
  /** Facebook Page has not accepted Lead Generation Terms of Service */
  META_LEAD_GEN_TOS_REQUIRED: 'META_LEAD_GEN_TOS_REQUIRED',
} as const;

export type CampaignErrorCode =
  (typeof CampaignErrorCodes)[keyof typeof CampaignErrorCodes];
