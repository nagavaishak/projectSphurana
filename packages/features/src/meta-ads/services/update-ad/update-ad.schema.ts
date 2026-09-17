import { metaCallToActionValues } from '@borradh-workspace/labels';
import { z } from 'zod';
import { adTargetingOverrideSchema } from '../create-ad/create-ad.schema.js';

/**
 * Schema for updating an ad
 */
export const updateAdSchema = z.object({
  adId: z.string().min(1, 'Ad ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  name: z
    .string()
    .min(1, 'Ad name is required')
    .max(255, 'Name too long')
    .optional(),
  headline: z.string().max(80, 'Headline too long').optional(),
  primaryText: z.string().max(500, 'Primary text too long').optional(),
  description: z.string().max(30, 'Description too long').optional(),
  callToAction: z.enum(metaCallToActionValues).optional(),
  destinationUrl: z.string().url('Invalid URL').optional(),
  targetingOverride: adTargetingOverrideSchema,
});

/**
 * Input type for updating an ad
 */
export type UpdateAdInput = z.infer<typeof updateAdSchema>;
