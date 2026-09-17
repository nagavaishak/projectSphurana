import { createCampaignRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';
import type { CampaignChannel, CampaignType } from './types';

/**
 * THE builder for the `POST campaigns` wire body. Both the composer's send flow
 * and the standalone `useCreateCampaign` hook construct the body here, so no two
 * surfaces can assemble it differently.
 *
 * The schema is no longer declared here: it is the CANONICAL request contract
 * (`packages/contracts/src/requests/campaigns.ts`), which the backend feature
 * schema also derives from. Re-exported under its historical name so callers do
 * not change.
 */

/** Typed intent for creating a campaign (form/flow values, not the wire body). */
export interface CreateCampaignIntent {
  name: string;
  channels: CampaignChannel[];
  type?: CampaignType;
  /** ISO-8601 datetime. The contract enforces the format. */
  scheduledAt?: string;
  segmentId?: string;
}

/** The exact `POST campaigns` wire body — the canonical contract. */
export const createCampaignBodySchema = createCampaignRequestSchema;

export type CreateCampaignBody = z.infer<typeof createCampaignBodySchema>;

export function buildCreateCampaignPayload(
  input: CreateCampaignIntent
): CreateCampaignBody {
  return createCampaignBodySchema.parse({
    name: input.name,
    type: input.type ?? 'custom',
    channels: input.channels,
    ...(input.segmentId !== undefined ? { segmentId: input.segmentId } : {}),
    // `.datetime()` on the contract rejects `''`, so a blank schedule input is
    // normalised to "unscheduled" rather than becoming a parse error.
    ...(input.scheduledAt !== undefined && input.scheduledAt !== ''
      ? { scheduledAt: input.scheduledAt }
      : {}),
  });
}
