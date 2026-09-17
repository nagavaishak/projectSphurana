import { type Offer, offerSchema } from '@borradh-workspace/contracts';
import {
  offerDiscountTypeValues,
  offerStateValues,
} from '@borradh-workspace/database';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { resolveToolDateTime } from '../_shared/resolve-tool-date.js';

const createOfferInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .describe('Internal offer name (operators see this in the dashboard).'),
  code: z
    .string()
    .max(40)
    .optional()
    .describe(
      'Optional case-insensitive coupon code; unique per organisation.'
    ),
  state: z
    .enum(offerStateValues)
    .optional()
    .describe(
      'Lifecycle state of the offer. Defaults to "active". Use "draft" to stage without publishing.'
    ),
  discountType: z
    .enum(offerDiscountTypeValues)
    .describe(
      'percentage | fixed_price | buy_x_get_y. Populate only the fields for the chosen type.'
    ),
  discountPercent: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(
      'Whole-number percent discount, 1–100. Required for percentage discounts.'
    ),
  originalPriceCents: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'Pre-discount price in cents. Optional companion to fixed_price for display.'
    ),
  offerPriceCents: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Discounted price in cents. Required for fixed_price.'),
  buyQuantity: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Required for buy_x_get_y.'),
  getQuantity: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Required for buy_x_get_y.'),
  limitPerClient: z
    .boolean()
    .optional()
    .describe(
      'Cap each client to a single redemption (enforced at redemption time by phone/email).'
    ),
  redemptionLimit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Total redemption cap across all clients. Omit for no cap.'),
  validFrom: z
    .string()
    .min(1)
    .optional()
    .describe(
      "When the offer STARTS. Pass the user's words verbatim — an ISO date " +
        '("2026-08-01"), a full datetime, or a relative phrase ("today", "next ' +
        'Monday"). The server resolves it against the real clock in the org ' +
        'timezone; do NOT compute a date yourself. Defaults to now if omitted.'
    ),
  validUntil: z
    .string()
    .min(1)
    .optional()
    .describe(
      "When the offer ENDS. Pass the user's words verbatim — an ISO date, a " +
        'full datetime, or a relative phrase ("valid for 2 weeks", "until ' +
        'August 7th", "end of the month", "in 30 days"). The server resolves ' +
        'it against the real clock in the org timezone (end of that day) and ' +
        'the created offer echoes the absolute date back. Do NOT compute a ' +
        'date yourself. Strongly recommended.'
    ),
  serviceIds: z
    .array(z.string().min(1))
    .optional()
    .describe('Service IDs the offer applies to. Empty = all services.'),
  ctaText: z
    .string()
    .max(100)
    .optional()
    .describe(
      'Custom CTA button text shown on the offer (e.g., "Book now", "Claim this offer"). Defaults to a generic CTA if omitted.'
    ),
  urgencyText: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Short urgency line shown alongside the offer (e.g., "Limited slots this month").'
    ),
  audienceText: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Audience targeting copy (e.g., "New clients only", "First-time visitors").'
    ),
  isActive: z
    .boolean()
    .optional()
    .describe(
      'Whether the offer is active and visible to customers. Defaults to true. Set false to create as draft.'
    ),
  bulletPoints: z.array(z.string().max(200)).max(4).optional(),
  locationIds: z
    .array(z.string().min(1))
    .optional()
    .describe('Location IDs the offer applies to. Empty = all org locations.'),
});

type CreateOfferInput = z.infer<typeof createOfferInputSchema>;

/**
 * `offers_createOffer` — non-destructive single-call. POSTs `/offers`.
 *
 * Creating an offer doesn't spend money or publish externally (it's setup,
 * like a draft / paused campaign), so it does NOT use the two-call approve
 * flow — that produced a redundant "double approval" on top of the chat
 * confirmation in the campaign flow. The safety validators still run inline
 * via `hardBlocks` (the factory enforces them for non-destructive tools too):
 * `noDiscountBelowCost` blocks below-cost discounts and `noFabricatedResultClaims`
 * blocks fabricated copy BEFORE the POST. The real money gate is launch.
 */
export const createOfferTool = defineTool<CreateOfferInput, Offer>({
  feature: 'offers',
  action: 'createOffer',
  description:
    'Create a new marketing offer in one call (no separate approval card — ' +
    'creating an offer spends nothing; the safety checks still run). Use ' +
    'after gathering: services covered (optional — empty = all services), ' +
    'discount shape (percentage, fixed_price, or buy_x_get_y), validity ' +
    'dates, and any limits.',
  inputSchema: createOfferInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  hardBlocks: ['noDiscountBelowCost', 'noFabricatedResultClaims'],
  presentation: {
    statusLabel: 'Creating offer',
  },
  execute: async (input, ctx) => {
    // Phase 3: resolve the model's date EXPRESSIONS server-side, in the org
    // timezone, from the real clock — the model never does date arithmetic.
    // `validFrom` → start of day, `validUntil` → end of day. Absolute ISO
    // datetimes pass through unchanged. Unresolvable → ApiFetchError(400) whose
    // message quotes today so the model self-corrects in-turn.
    const body = {
      ...input,
      ...(input.validFrom
        ? {
            validFrom: resolveToolDateTime(
              input.validFrom,
              ctx.timezone,
              'start'
            ),
          }
        : {}),
      ...(input.validUntil
        ? {
            validUntil: resolveToolDateTime(
              input.validUntil,
              ctx.timezone,
              'end'
            ),
          }
        : {}),
    };
    // Pass the body as a plain OBJECT: `apiFetch` JSON.stringifies it itself,
    // so pre-stringifying here would double-encode the body and the API
    // would reject it.
    // `POST /offers` returns the created offer row verbatim — including the
    // resolved absolute `validFrom`/`validUntil`, which is the echo the user
    // sees ("valid for 2 weeks" → validUntil 2026-08-13).
    const created = await ctx.apiFetch('offers', {
      method: 'POST',
      body,
      schema: offerSchema,
    });
    return { data: created };
  },
});
