import type {
  MetaCampaignObjective,
  MetaTargeting,
} from '@borradh-workspace/database';

/**
 * Campaign objective type - derived from database labels (source of truth)
 */
export type CampaignObjective = MetaCampaignObjective;

/**
 * Targeting configuration for campaigns - derived from database (source of truth)
 */
export type CampaignTargeting = MetaTargeting;
