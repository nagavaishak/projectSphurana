import {
  type Offer,
  offerSchema,
  offerWithServicesSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';

const expireOfferInputSchema = z.object({
  offerId: z.string().min(1).describe('The ID of the offer to force-expire.'),
  reason: z
    .string()
    .max(500)
    .optional()
    .describe(
      'Optional human note on why the offer is being expired (logged in the confirmation payload, not on the offer row).'
    ),
  confirmationToken: z
    .string()
    .optional()
    .describe('Set on the second call only.'),
});

type ExpireOfferInput = z.infer<typeof expireOfferInputSchema>;

/**
 * `offers_expireOffer` — destructive. PUTs `/offers/:id` with
 * `state: 'expired'` (post-Window-1 the offer table uses a state enum
 * rather than an `isActive` boolean).
 *
 * The thin-wrapper rationale is the same as `extendOffer` — own
 * `destructiveAction` enum value (`expire_offer`) for audit clarity, and a
 * dedicated tool surface lets the prompt phrase expiry as a deliberate
 * choice (versus a generic `updateOffer` call that could happen with no
 * intent ceremony).
 */
export const expireOfferTool = defineTool<ExpireOfferInput, Offer>({
  feature: 'offers',
  action: 'expireOffer',
  description:
    'Force-expire an active offer (sets state="expired"). Use when the operator decides to pull the offer ahead of its scheduled end, or when the offer was never supposed to run. Confirms before applying.',
  inputSchema: expireOfferInputSchema,
  destructive: true,
  destructiveAction: 'expire_offer',
  preferredModel: 'sonnet',
  hardBlocks: [],
  presentation: {
    statusLabel: 'Expiring offer',
    confirmationRenderer: 'OfferConfirmation',
  },
  summarizeForConfirmation: async (input, ctx) => {
    let offerName = input.offerId;
    let validUntil: string | null = null;
    let state = 'unknown';
    try {
      const data = await ctx.apiFetch(`offers/${input.offerId}`, {
        schema: offerWithServicesSchema,
      });
      offerName = data.offer.name;
      validUntil = data.offer.validUntil;
      state = data.offer.state;
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue(
          'Offer lookup failed while building expire-offer confirmation',
          { error }
        );
      }
      // Best-effort.
    }
    const fields: { label: string; value: string }[] = [
      { label: 'Offer ID', value: input.offerId },
      { label: 'Current state', value: state },
    ];
    if (validUntil) {
      fields.push({ label: 'Scheduled end', value: validUntil });
    }
    if (input.reason) {
      fields.push({ label: 'Reason', value: input.reason });
    }
    return {
      title: `Expire offer: "${offerName}"`,
      fields,
      resourceId: input.offerId,
      payload: input.reason ? { reason: input.reason } : undefined,
    };
  },
  execute: async (input, ctx) => {
    // `PUT /offers/:id` returns the updated offer row verbatim.
    const updated = await ctx.apiFetch(`offers/${input.offerId}`, {
      method: 'PUT',
      // Plain object — apiFetch JSON-stringifies it (pre-stringifying
      // double-encodes the body and the API rejects it).
      body: { state: 'expired' },
      schema: offerSchema,
    });
    return { data: updated };
  },
});
