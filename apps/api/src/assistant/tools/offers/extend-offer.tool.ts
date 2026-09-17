import {
  type Offer,
  offerSchema,
  offerWithServicesSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';
import { resolveToolDateTime } from '../_shared/resolve-tool-date.js';

const extendOfferInputSchema = z.object({
  offerId: z.string().min(1).describe('The ID of the offer to extend.'),
  newValidUntil: z
    .string()
    .min(1)
    .describe(
      "The new end date. Pass the user's words verbatim — an ISO date, a full " +
        'datetime, or a relative phrase ("another 2 weeks", "until end of ' +
        'August", "in 10 days"). The server resolves it against the real clock ' +
        'in the org timezone (end of that day); do NOT compute a date yourself. ' +
        'Must resolve later than the current validUntil.'
    ),
  confirmationToken: z
    .string()
    .optional()
    .describe('Set on the second call only.'),
});

type ExtendOfferInput = z.infer<typeof extendOfferInputSchema>;

/**
 * `offers_extendOffer` — destructive. PUTs `/offers/:id` with a new
 * `validUntil`. Thin wrapper around `updateOffer`; kept as its own factory
 * tool so:
 *   1. The destructive-action enum is `extend_offer` (audit trail clarity).
 *   2. The skill prompt can phrase extend as a deliberate choice (track-c08
 *      §Step 4, point 5: prefer refresh over a longer run when an offer is
 *      underperforming — the model is biased toward this conversation by
 *      the dedicated tool surface, not the generic update).
 *
 * Loads the offer first to surface the current `validUntil` in the
 * confirmation summary.
 */
export const extendOfferTool = defineTool<ExtendOfferInput, Offer>({
  feature: 'offers',
  action: 'extendOffer',
  description:
    'Extend an existing offer by setting a new `validUntil` date. Use this when the operator wants the offer to keep running past its original end. Confirms before applying. If the offer is underperforming, suggest a refreshed offer (different copy or services) instead of a longer run.',
  inputSchema: extendOfferInputSchema,
  destructive: true,
  destructiveAction: 'extend_offer',
  preferredModel: 'sonnet',
  hardBlocks: ['noDiscountBelowCost'],
  presentation: {
    statusLabel: 'Extending offer',
    confirmationRenderer: 'OfferConfirmation',
  },
  summarizeForConfirmation: async (input, ctx) => {
    let currentValidUntil: string | null = null;
    let offerName = input.offerId;
    try {
      const data = await ctx.apiFetch(`offers/${input.offerId}`, {
        schema: offerWithServicesSchema,
      });
      currentValidUntil = data.offer.validUntil;
      offerName = data.offer.name;
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue(
          'Offer lookup failed while building extend-offer confirmation',
          { error }
        );
      }
      // Best-effort lookup; if the offer can't be fetched the confirmation
      // still issues so the user sees the model's intent. Token verification
      // on the second call binds against `offerId`.
    }
    // Phase 3: resolve the expression server-side so the operator confirms
    // against the ABSOLUTE date, not the raw phrase. The payload deliberately
    // binds the raw expression (deterministic → the second call's identical
    // expression matches); `execute` re-resolves from the same clock.
    const resolvedNewEnd = resolveToolDateTime(
      input.newValidUntil,
      ctx.timezone,
      'end'
    );
    return {
      title: `Extend offer: "${offerName}"`,
      fields: [
        { label: 'Offer ID', value: input.offerId },
        {
          label: 'Current end',
          value: currentValidUntil ?? '(not set)',
        },
        { label: 'New end', value: resolvedNewEnd },
      ],
      resourceId: input.offerId,
      payload: {
        previousValidUntil: currentValidUntil,
        newValidUntil: input.newValidUntil,
      },
    };
  },
  execute: async (input, ctx) => {
    // Resolve the expression against the real clock in the org timezone
    // (end of day). Absolute ISO passes through; unresolvable → ApiFetchError(400).
    const validUntil = resolveToolDateTime(
      input.newValidUntil,
      ctx.timezone,
      'end'
    );
    // `PUT /offers/:id` returns the updated offer row verbatim — carrying the
    // resolved absolute `validUntil`, which is the echo the user sees.
    const updated = await ctx.apiFetch(`offers/${input.offerId}`, {
      method: 'PUT',
      // Plain object — apiFetch JSON-stringifies it (pre-stringifying
      // double-encodes the body and the API rejects it).
      body: { validUntil },
      schema: offerSchema,
    });
    return { data: updated };
  },
});
