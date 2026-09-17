/**
 * Campaign-specific error codes, layered on top of the shared ErrorCodes.
 */
export const CampaignErrorCodes = {
  SEGMENT_NOT_FOUND: 'SEGMENT_NOT_FOUND',
  CAMPAIGN_NOT_FOUND: 'CAMPAIGN_NOT_FOUND',
  CAMPAIGN_NOT_EDITABLE: 'CAMPAIGN_NOT_EDITABLE',
  NO_ELIGIBLE_RECIPIENTS: 'NO_ELIGIBLE_RECIPIENTS',
  CHANNEL_NOT_CONFIGURED: 'CHANNEL_NOT_CONFIGURED',
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
} as const;

export type CampaignErrorCode =
  (typeof CampaignErrorCodes)[keyof typeof CampaignErrorCodes];
