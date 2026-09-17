// Campaign models barrel

export {
  CampaignErrorCodes,
  type CampaignErrorCode,
} from './campaign.errors.js';

// Re-export the entity + JSONB types from the database schema so consumers
// import campaign types from the feature package, not the schema directly.
export type {
  Campaign,
  NewCampaign,
  CampaignMessage,
  NewCampaignMessage,
  CampaignRecipient,
  NewCampaignRecipient,
  CampaignEvent,
  NewCampaignEvent,
  Segment,
  NewSegment,
  Suppression,
  NewSuppression,
  SegmentFilter,
  OrgSmsNumber,
  NewOrgSmsNumber,
} from '@borradh-workspace/database';
