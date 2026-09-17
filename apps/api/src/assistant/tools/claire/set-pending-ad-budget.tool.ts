import { db } from '@borradh-workspace/database';
import { getOrCreateDraftAd } from '@borradh-workspace/features/claire';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { resolveAdAccountCurrency } from '../_shared/ad-currency.js';
import { adToSnapshot } from './_helpers.js';
import type { DraftAdSnapshot } from './types.js';

/**
 * `claire_setPendingAdBudget` — record budget intent for the draft.
 *
 * Budget lives on the Meta ad set (`daily_budget` or `lifetime_budget`),
 * not the ad row, and the ad set is created at launch time. Same shape
 * caveat as `set_pending_ad_schedule`: persisted at launch via the
 * preview card, returned here for the model so it can confirm with the
 * user.
 *
 * The display currency is derived server-side from the connected Meta ad
 * account (see `resolveAdAccountCurrency`), NOT from a model-supplied guess —
 * a mismatch is impossible by construction. The amount itself is never
 * converted: `dailyBudgetCents` is spent as-is in the resolved currency.
 */
export const setPendingAdBudgetTool = defineTool<
  { dailyBudgetCents: number },
  (DraftAdSnapshot & { budgetNote: string }) | { error: string }
>({
  feature: 'claire',
  action: 'setPendingAdBudget',
  description:
    'Record the daily budget intent for the draft ad, in minor units (cents) of the ad-account currency. The currency is resolved from the connected Meta ad account automatically — do not pass or assume one. Budgets are applied at launch via the preview card.',
  inputSchema: z.object({
    dailyBudgetCents: z.number().int().min(100),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Noting daily budget' },
  execute: async (input, ctx) => {
    const draft = await getOrCreateDraftAd(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
    });
    if (!draft.success) return { data: { error: draft.error.message } };

    const { currency, resolved } = await resolveAdAccountCurrency(ctx);
    const amount = `${currency.symbol}${(input.dailyBudgetCents / 100).toFixed(
      2
    )}`;
    const caveat = resolved
      ? ''
      : ' (assuming EUR — connect your Meta ad account to lock the real currency)';
    return {
      data: {
        ...adToSnapshot(draft.data.ad, draft.data.serviceIds),
        budgetNote: `Daily budget recorded: ${amount} /day${caveat}. Confirm or adjust on the preview card.`,
      },
    };
  },
});
