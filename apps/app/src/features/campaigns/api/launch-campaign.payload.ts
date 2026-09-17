import { launchCampaignRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';

/**
 * THE builder for the campaign lifecycle wire body (`POST campaigns/:id/launch`
 * and its resume/cancel siblings). The endpoint takes no body — the CANONICAL
 * contract (`packages/contracts/src/requests/campaigns.ts`) pins that as an
 * explicit, strict empty object so the shape can't drift.
 */
export const launchCampaignBodySchema = launchCampaignRequestSchema;

export type LaunchCampaignBody = z.infer<typeof launchCampaignBodySchema>;

export function buildLaunchCampaignPayload(): LaunchCampaignBody {
  return launchCampaignBodySchema.parse({});
}
