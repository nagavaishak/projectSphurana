import {
  clinicAreaTypeValues,
  giftCardExpiryValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * Partial patch for `org_defaults`. All value columns are optional and
 * may be `null` to explicitly clear a previously-set value (which then
 * falls back to the system default at read time).
 */
export const updateOrgDefaultsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  adDailyBudgetCents: z.number().int().positive().nullable().optional(),
  adObjective: z.string().min(1).nullable().optional(),
  videoOrientation: z
    .enum(['landscape', 'portrait', 'square'])
    .nullable()
    .optional(),
  videoLengthSecs: z.number().int().positive().nullable().optional(),
  brandVoice: z.string().min(1).nullable().optional(),
  defaultServiceIdForAds: z.string().min(1).nullable().optional(),
  adAreaType: z.enum(clinicAreaTypeValues).nullable().optional(),
  wageAutoClockIn: z.boolean().nullable().optional(),
  wageAutoClockOut: z.boolean().nullable().optional(),
  wageAutomatedBreaks: z.boolean().nullable().optional(),
  giftCardPresetAmounts: z
    .array(z.number().int().positive())
    .min(1)
    .max(10)
    .nullable()
    .optional(),
  giftCardExpiry: z.enum(giftCardExpiryValues).nullable().optional(),
});

export type UpdateOrgDefaultsInput = z.infer<typeof updateOrgDefaultsSchema>;
