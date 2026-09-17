import { db } from '@borradh-workspace/database';
import {
  getOrCreateDraftAd,
  updateDraftAd,
} from '@borradh-workspace/features/claire';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { adToSnapshot } from './_helpers.js';
import type { DraftAdSnapshot } from './types.js';

/**
 * `claire_setPendingAdCreative` — attach a video or image to the draft.
 * The id may reference the `video` table (AI/rendered video) or the `asset`
 * table (media uploaded by the operator — video OR image). Both ride the
 * draft's `videoId` slot; the launch path resolves either (an image asset
 * becomes a Meta image creative). The launch path validates the creative lives.
 */
export const setPendingAdCreativeTool = defineTool<
  { videoId?: string; assetId?: string },
  DraftAdSnapshot | { error: string }
>({
  feature: 'claire',
  action: 'setPendingAdCreative',
  description:
    'Attach a creative to the draft ad. Pass `videoId` for a video, or `assetId` ' +
    "for one of the operator's OWN uploaded library images/videos (from " +
    'listLibraryImages). Exactly one. The creative must be ready before publishing.',
  inputSchema: z
    .object({
      videoId: z.string().min(1).optional(),
      assetId: z
        .string()
        .min(1)
        .optional()
        .describe(
          "A library / uploaded media asset ID from the operator's own media " +
            'library (from listLibraryImages).'
        ),
    })
    .refine((i) => Number(!!i.videoId) + Number(!!i.assetId) === 1, {
      message: 'Provide exactly one creative: a videoId or an assetId',
      path: ['assetId'],
    }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Attaching creative' },
  execute: async (input, ctx) => {
    // A library / uploaded asset id rides the draft's `videoId` slot — the
    // launch path resolves the asset table there (an image asset becomes a
    // Meta image creative).
    const creativeId = input.videoId ?? input.assetId;
    if (!creativeId) {
      return { data: { error: 'Provide a videoId or an assetId' } };
    }
    const draft = await getOrCreateDraftAd(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
    });
    if (!draft.success) return { data: { error: draft.error.message } };
    const updated = await updateDraftAd(db, {
      organizationId: ctx.organizationId,
      draftId: draft.data.ad.id,
      update: { videoId: creativeId },
    });
    if (!updated.success) return { data: { error: updated.error.message } };
    return { data: adToSnapshot(updated.data.ad, updated.data.serviceIds) };
  },
});
