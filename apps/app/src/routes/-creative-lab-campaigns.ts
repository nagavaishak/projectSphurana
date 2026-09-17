export interface LabAd {
  id: string;
  name: string;
  status: string;
  isImported: boolean;
  adPlacement: string | null;
  headline: string | null;
  primaryText: string | null;
  description: string | null;
  callToAction: string;
  destinationUrl: string | null;
  hasLeadForm: boolean;
  kind: string;
  video: string | null;
  image: string | null;
  w: number | null;
  h: number | null;
  imageBefore: string | null;
  wBefore: number | null;
  hBefore: number | null;
}

export interface LabCampaign {
  organizationId: string;
  organizationName: string;
  metaCampaignId: string;
  ads: LabAd[];
}

/**
 * Committed EMPTY on purpose - real customers' ad copy and creatives.
 * Repopulate locally with:
 *   scripts/prod-run.sh pnpm exec tsx scripts/sample-ad-campaigns.ts
 */
export const labCampaigns: LabCampaign[] = [];
