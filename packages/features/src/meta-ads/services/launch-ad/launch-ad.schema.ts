import {
  adPlacementValues,
  conversionDestinationValues,
  followUpTypeValues,
  messagingDestinationValues,
  metaCallToActionValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';
import { adTargetingOverrideSchema } from '../create-ad/create-ad.schema.js';

/**
 * Schema for launching an ad (create + publish in one step)
 * Requires an existing campaign — inline campaign creation is no longer supported.
 */
export const launchAdSchema = z.object({
  // Existing Meta campaign (required)
  metaCampaignId: z.string().min(1, 'Meta Campaign ID is required'),

  // Creative reference — media-agnostic. Provide exactly one of videoId /
  // graphicId (enforced in the service layer).
  videoId: z.string().min(1).optional(),
  /** Image creative — references a rendered `graphic.id`. */
  graphicId: z.string().min(1).optional(),

  // Organization context
  organizationId: z.string().min(1, 'Organization ID is required'),

  // Ad details
  name: z.string().min(1, 'Ad name is required').max(255, 'Name too long'),
  headline: z.string().max(80, 'Headline too long').optional(),
  primaryText: z.string().max(500, 'Primary text too long').optional(),
  description: z.string().max(30, 'Description too long').optional(),
  callToAction: z.enum(metaCallToActionValues).default('LEARN_MORE'),
  destinationUrl: z.string().url('Invalid URL').optional(),
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

  /**
   * @deprecated Legacy single-destination field. New callers should use
   * `destinations` below. Kept for one release so existing UI paths keep
   * working while ENG-178 migrates the ad wizard picker.
   */
  conversionDestination: z.enum(conversionDestinationValues).optional(),

  /**
   * Messaging destinations for this ad. Non-empty subset of
   * ('whatsapp' | 'messenger' | 'instagram_dm'). When provided on a
   * chatbot ad, launch-ad resolves the set to a Meta combo
   * destination_type and finds or creates a matching ad set under the
   * campaign. Ads with the same destinations within a campaign share
   * the same ad set.
   */
  destinations: z
    .array(z.enum(messagingDestinationValues))
    .nonempty()
    .optional(),

  metaAdsPageId: z.string().min(1).optional(),

  /**
   * Override the ad set optimization goal. When omitted, defaults to
   * CONVERSATIONS for chatbot ads or LEAD_GENERATION for lead ads.
   * EU-targeting WhatsApp ads need LINK_CLICKS because Meta blocks
   * CONVERSATIONS in Europe.
   */
  optimizationGoal: z.enum(['CONVERSATIONS', 'LINK_CLICKS']).optional(),
});

/**
 * Input type for launching an ad
 */
export type LaunchAdInput = z.infer<typeof launchAdSchema>;
