import {
  adPlacementValues,
  conversionDestinationValues,
  followUpTypeValues,
  metaCallToActionValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * Base targeting object shape (shared between required and optional schemas).
 */
const targetingObjectSchema = z.object({
  /** Location name for display (e.g. "Dublin, Ireland") */
  location: z.string().optional(),
  /** Latitude for radius targeting (-90 to 90) */
  latitude: z.number().min(-90).max(90).optional(),
  /** Longitude for radius targeting (-180 to 180) */
  longitude: z.number().min(-180).max(180).optional(),
  /** Radius in kilometers (1-500, used with lat/lng) */
  distanceKm: z.number().min(1).max(500).optional(),
  /** Minimum age (18-65) — maps to Facebook's age_min */
  ageMin: z.number().min(18).max(65).optional(),
  /** Maximum age (18-65) — maps to Facebook's age_max */
  ageMax: z.number().min(18).max(65).optional(),
  /** Gender targeting: 1 = male, 2 = female — maps to Facebook's genders array */
  genders: z.array(z.number().min(1).max(2)).optional(),
  /**
   * ISO 3166-1 alpha-2 country codes — maps to Facebook's
   * geo_locations.countries. Prefer lat/lng radius targeting; only set this
   * for the org's OWN country, never a hardcoded example.
   */
  countries: z.array(z.string().length(2)).optional(),
});

/**
 * Targeting schema for ads (required on create/launch).
 * Must provide geo targeting: either (latitude + longitude) or countries.
 * Format matches Facebook Marketing API's targeting spec.
 */
export const adTargetingSchema = targetingObjectSchema.refine(
  (data) =>
    (data.latitude !== undefined && data.longitude !== undefined) ||
    (data.countries !== undefined && data.countries.length > 0),
  {
    message:
      'Targeting must include either coordinates (latitude + longitude) or at least one country code',
  }
);

/**
 * Optional targeting override schema for updates.
 * Does NOT require geo targeting — allows partial updates (e.g. just age/gender).
 */
export const adTargetingOverrideSchema = targetingObjectSchema.optional();

/**
 * Schema for creating a new ad
 */
export const createAdSchema = z.object({
  metaCampaignId: z.string().min(1, 'Meta Campaign ID is required'),
  // Creative is media-agnostic: provide exactly one of videoId / graphicId.
  // (Enforced in the service layer so this stays a plain ZodObject for the
  // DTO's `.omit()` and downstream `.extend()`/`.pick()` consumers.)
  videoId: z.string().min(1).optional(),
  /** Image creative — references a rendered `graphic.id`. */
  graphicId: z.string().min(1).optional(),
  organizationId: z.string().min(1, 'Organization ID is required'),
  name: z.string().min(1, 'Ad name is required').max(255, 'Name too long'),
  headline: z.string().max(80, 'Headline too long').optional(),
  primaryText: z.string().max(500, 'Primary text too long').optional(),
  description: z.string().max(30, 'Description too long').optional(),
  callToAction: z.enum(metaCallToActionValues).default('LEARN_MORE'),
  destinationUrl: z.string().url('Invalid URL').optional(),
  targeting: adTargetingOverrideSchema,
  // Follow-up configuration
  followUpType: z.enum(followUpTypeValues).default('lead_form'),
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
  /**
   * When true, delete this campaign's existing DRAFT ads before creating the
   * new one. Used when the assistant rebuilds a campaign's ad set after a
   * pre-launch edit (e.g. the operator changed the offer or regenerated the
   * creatives), so a rebuild REPLACES the previous drafts instead of stacking
   * on top of them. Without this, editing a 3-ad campaign leaves the original
   * 3 drafts in place and adds 3 more — all 6 then launch and split the ad-set
   * budget. Only `draft` ads are removed; launching/live ads are never touched.
   *
   * Optional (not defaulted) so it stays absent from the inferred input type —
   * existing callers (the ad wizard, one-off ad creation) don't pass it, and
   * the service treats an absent/false value as "don't touch existing drafts".
   */
  replaceCampaignDrafts: z.boolean().optional(),
});

/**
 * Input type for creating an ad
 */
export type CreateAdInput = z.infer<typeof createAdSchema>;
