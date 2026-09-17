import { z } from 'zod';

/**
 * The targeting knobs an update may change.
 *
 * NO GEO INPUT — same rule as creation. Moving a campaign to a different area
 * means moving it to a different BRANCH (`locationId` below); the coordinates
 * are then re-derived from that branch's geocoded address. Accepting
 * `latitude` / `longitude` here was the other half of the hole that let a model
 * point an ad at Null Island.
 */
const updateTargetingSchema = z.object({
  distanceKm: z.number().min(1).max(500).optional(),
  ageMin: z.number().min(18).max(65).optional(),
  ageMax: z.number().min(18).max(65).optional(),
  genders: z.array(z.number().min(1).max(2)).optional(),
  countries: z.array(z.string().length(2)).optional(),
});

/**
 * Schema for updating a campaign on Meta (name, daily budget, and/or targeting)
 */
export const updateCampaignSchema = z.object({
  metaCampaignId: z.string().min(1, 'Meta Campaign ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  name: z
    .string()
    .min(1, 'Name is required')
    .max(255, 'Name is too long')
    .optional(),
  dailyBudget: z
    .number()
    .int()
    .min(100, 'Minimum daily budget is 1.00 in your account currency')
    .optional(),
  /**
   * Move the campaign to a different branch. Re-derives the radius centre and
   * the displayed label from that branch. Omitted leaves the campaign where it
   * is; supplying only `targeting` re-uses the campaign's existing branch.
   */
  locationId: z.string().min(1).optional(),
  targeting: updateTargetingSchema.optional(),
});

export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
