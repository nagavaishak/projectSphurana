import { db } from '@borradh-workspace/database';
import { getOrCreateDraftAd } from '@borradh-workspace/features/claire';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { adToSnapshot } from './_helpers.js';
import type { DraftAdSnapshot } from './types.js';

/**
 * `claire_setPendingAdSchedule` — record run-window intent for the draft.
 *
 * Schedule lives on the Meta ad set, not the ad row itself, and the ad
 * set is created at launch time by the existing `launchAd` service.
 * Until then we surface the intent to the user via the snapshot but do
 * NOT persist it on the draft row (the Window-1 schema didn't add the
 * fields). The preview card (Window 7) collects start/end and forwards
 * them at publish time.
 *
 * Returning the unchanged draft + the requested schedule keeps the tool
 * usable today; when the schema gains an ad_set draft column, this tool
 * can start persisting.
 */
export const setPendingAdScheduleTool = defineTool<
  { startDate: string; endDate?: string },
  (DraftAdSnapshot & { scheduleNote: string }) | { error: string }
>({
  feature: 'claire',
  action: 'setPendingAdSchedule',
  description:
    'Record the run-window intent for the draft ad. Pass startDate (ISO date) and optional endDate (ISO date). Note: the schedule is collected on the preview card and applied at launch time — the draft itself does not persist start/end dates.',
  inputSchema: z.object({
    startDate: z.string().min(1),
    endDate: z.string().min(1).optional(),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Noting ad schedule' },
  execute: async (input, ctx) => {
    const draft = await getOrCreateDraftAd(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
    });
    if (!draft.success) return { data: { error: draft.error.message } };
    return {
      data: {
        ...adToSnapshot(draft.data.ad, draft.data.serviceIds),
        scheduleNote: input.endDate
          ? `Schedule recorded: ${input.startDate} → ${input.endDate}. Final dates are confirmed on the preview card.`
          : `Start recorded: ${input.startDate}. Pick an end date on the preview card before publishing.`,
      },
    };
  },
});
