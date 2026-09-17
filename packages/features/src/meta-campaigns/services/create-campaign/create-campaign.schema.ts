import {
  conversionDestinationValues,
  followUpTypeValues,
  messagingDestinationValues,
  metaCampaignObjectiveValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * The targeting knobs a human actually chooses.
 *
 * NO GEO INPUT. `location`, `latitude` and `longitude` used to live here and
 * were supplied by the caller — including, for the assistant tools, by a
 * language model. That is how an ad ran targeted at Null Island (register #82)
 * and how the onboarding launcher's `countries: ['IE']` last resort sent US and
 * UK spend to Ireland. Geo now comes from `locationId` on the campaign, and the
 * branch's coordinates are the geocoded ones the location form maintains.
 * See `_shared/resolve-campaign-location.ts`.
 *
 * `countries` survives as the deliberate national-targeting mode (online-only
 * businesses, or a launch that genuinely wants a whole market). It is a choice,
 * not a fallback — nothing writes it when a geocode is missing.
 */
export const campaignTargetingSchema = z.object({
  /** Radius around the campaign's branch. Meta default is 25km. */
  distanceKm: z.number().min(1).max(500).optional(),
  ageMin: z.number().min(18).max(65).optional(),
  ageMax: z.number().min(18).max(65).optional(),
  genders: z.array(z.number().min(1).max(2)).optional(),
  /** National targeting instead of a radius. */
  countries: z.array(z.string().length(2)).optional(),
});

/**
 * Optional campaign start/end date.
 *
 * Dates arrive over HTTP as ISO strings, so the coercion belongs here and not in
 * the controller. The falsy→undefined preprocess reproduces exactly the
 * `dto.startDate ? new Date(dto.startDate) : undefined` step the controller used
 * to run: an empty string (or any other falsy value) means "no date" rather than
 * an invalid one.
 */
const optionalCampaignDate = z.preprocess(
  (value) => value || undefined,
  z.coerce.date().optional()
);

/**
 * Schema for creating a new campaign on Meta.
 * Targeting is set at the campaign level — all ads share the same ad set.
 */
export const createCampaignSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  name: z
    .string()
    .min(1, 'Campaign name is required')
    .max(255, 'Name too long'),
  objective: z.enum(metaCampaignObjectiveValues),
  dailyBudget: z.number().positive('Daily budget must be positive').optional(),
  lifetimeBudget: z
    .number()
    .positive('Lifetime budget must be positive')
    .optional(),
  startDate: optionalCampaignDate,
  endDate: optionalCampaignDate,

  /**
   * The BRANCH this campaign is for. Its geocoded coordinates become the radius
   * centre, its address the displayed label, and (once branch-aware booking
   * lands) its slug the ad's landing page.
   *
   * Optional so a single-location org never has to name the only branch it has
   * — omitted resolves to the org's default branch. A foreign id is a
   * NOT_FOUND, never a silent fallback.
   */
  locationId: z.string().min(1).optional(),

  // Campaign-level targeting knobs (geo comes from `locationId`).
  //
  // `.optional()` rather than `.default({})` deliberately: a default makes the
  // z.infer OUTPUT type diverge from what a caller has to construct, and this
  // type is exported as `CreateCampaignInput`. The service reads
  // `targeting ?? {}`.
  targeting: campaignTargetingSchema.optional(),

  // Campaign-level config (stored locally, not on Meta)
  followUpType: z.enum(followUpTypeValues).default('lead_form'),
  conversionDestination: z.enum(conversionDestinationValues).optional(),

  // Messaging destinations for chatbot campaigns (e.g. ['whatsapp', 'messenger'])
  destinations: z.array(z.enum(messagingDestinationValues)).optional(),

  // Lead form for lead_form campaigns. Ads launched in the campaign inherit
  // this form when they don't specify their own.
  leadFormId: z.string().min(1).optional(),

  // Optional page selection (for multi-page support)
  metaAdsPageId: z.string().min(1).optional(),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
