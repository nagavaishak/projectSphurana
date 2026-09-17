import { db } from '@borradh-workspace/database';
import {
  getOrCreateDraftAd,
  updateDraftAd,
} from '@borradh-workspace/features/claire';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { resolveAdAccountCurrency } from '../_shared/ad-currency.js';
import { adToSnapshot } from './_helpers.js';
import type { DraftAdSnapshot } from './types.js';

/**
 * `claire_setPendingAdPrice` — set the intro price displayed in the ad
 * copy. The Window-1 ad schema doesn't have a dedicated price column;
 * this tool encodes the price into the headline ("Just {symbol}{price} —
 * <existing headline>") so the ad creative shows it prominently.
 *
 * Per the discount-format spec we lead with a concrete "Just X" price,
 * never a "% off" framing ("30% off feels cheap"). The offer draft owns the
 * fuller "Was X → now X" anchor; this single-field ad headline uses the
 * shorter "Just X" variant.
 *
 * The currency symbol is derived server-side from the connected Meta ad
 * account (see `resolveAdAccountCurrency`), never from a model-supplied guess,
 * so the price in the ad copy always matches the account the org will spend on.
 *
 * If the operator also wants a redeemable offer code attached, they
 * use `set_pending_offer_*` tools to spin up an offer draft separately.
 */
export const setPendingAdPriceTool = defineTool<
  { introPrice: number },
  DraftAdSnapshot | { error: string }
>({
  feature: 'claire',
  action: 'setPendingAdPrice',
  description:
    'Set the intro price shown in the ad copy. This rewrites the headline to lead with a concrete "Just X" price (e.g. "Just £125 — ..."), never a "% off" framing. The currency symbol is resolved from the connected Meta ad account automatically — do not pass or assume one. To attach a redeemable code, use the offer tools separately.',
  inputSchema: z.object({
    introPrice: z.number().min(0),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Setting intro price on the ad' },
  execute: async (input, ctx) => {
    const draft = await getOrCreateDraftAd(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
    });
    if (!draft.success) return { data: { error: draft.error.message } };

    const { currency } = await resolveAdAccountCurrency(ctx);
    const priceLabel = `Just ${currency.symbol}${input.introPrice}`;

    // Strip any prior price-prefix on the headline before re-prefixing, so
    // repeated set_pending_ad_price calls don't stack. Only the two shapes this
    // codebase ever writes are stripped: "Just €X — " and the legacy
    // "€X intro — ". The symbol part allows a short letter run because symbols
    // can be multi-char ("kr", "CHF"), but it is ONLY reachable behind the
    // "Just " / "intro" markers — a bare leading "<word> <number> - " (e.g. an
    // operator's "Top 10 - reasons to choose us") must never be eaten.
    // Bounded quantifiers keep it linear (no ReDoS).
    const existingHeadline = (draft.data.ad.headline ?? '').replace(
      /^(?:just\s+(?:[€$£¥]|\p{L}{1,3})?[\d.]+|(?:[€$£¥]|\p{L}{1,3})?[\d.]+\s*intro(?:ductory)?)\s*[—-]\s*/iu,
      ''
    );
    const nextHeadline = `${priceLabel} — ${existingHeadline}`.slice(0, 80);

    const updated = await updateDraftAd(db, {
      organizationId: ctx.organizationId,
      draftId: draft.data.ad.id,
      update: { headline: nextHeadline },
    });
    if (!updated.success) return { data: { error: updated.error.message } };
    return { data: adToSnapshot(updated.data.ad, updated.data.serviceIds) };
  },
});
