import {
  adPlacementValues,
  conversionDestinationValues,
  followUpTypeValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';
import { adTargetingOverrideSchema } from '../create-ad/create-ad.schema.js';

/**
 * Schema for launching an ad from an existing published social post.
 * Uses the post's content as ad creative via effective_object_story_id.
 * No video upload or copy customization needed — the post is used as-is.
 */
export const launchAdFromPostSchema = z.object({
  // Existing Meta campaign (required)
  metaCampaignId: z.string().min(1, 'Meta Campaign ID is required'),

  // Social post to boost (required instead of videoId)
  socialPostId: z.string().min(1, 'Social Post ID is required'),

  // Organization context
  organizationId: z.string().min(1, 'Organization ID is required'),

  // Ad details
  name: z.string().min(1, 'Ad name is required').max(255, 'Name too long'),
  targeting: adTargetingOverrideSchema,

  // Follow-up configuration (denormalized from campaign config)
  followUpType: z.enum(followUpTypeValues).default('email_only'),

  // Lead generation fields
  leadFormId: z.string().min(1).optional(),
  sequenceId: z.string().min(1).optional(),

  // Service selection
  serviceIds: z
    .array(z.string().min(1))
    .min(1, 'At least one service is required'),

  // Ad placement & conversion destination
  adPlacement: z.enum(adPlacementValues).default('facebook'),
  conversionDestination: z.enum(conversionDestinationValues).optional(),
  metaAdsPageId: z.string().min(1).optional(),
});

/**
 * Input type for launching an ad from a post
 */
export type LaunchAdFromPostInput = z.infer<typeof launchAdFromPostSchema>;
