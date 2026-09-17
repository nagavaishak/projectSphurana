import type {
  MetaAd,
  MetaAdStatus,
  MetaCallToAction,
  MetaTargeting,
} from '@borradh-workspace/database';

/**
 * Ad with its video reference
 */
export interface AdWithVideo extends MetaAd {
  video: {
    id: string;
    title: string;
    thumbnailUrl: string | null;
    videoUrl: string | null;
    duration: number | null;
  };
}

/**
 * Ad list item for display
 */
export interface AdListItem {
  id: string;
  metaCampaignId: string | null;
  name: string;
  headline: string | null;
  status: string;
  metaStatus: string | null;
  videoId: string;
  videoThumbnail: string | null;
  createdAt: Date;
}

/**
 * Ad status type - derived from database labels (source of truth)
 */
export type AdStatus = MetaAdStatus;

/**
 * Call to action type - derived from database labels (source of truth)
 */
export type CallToAction = MetaCallToAction;

/**
 * Ad targeting configuration (same as campaign)
 */
export type AdTargeting = MetaTargeting;
