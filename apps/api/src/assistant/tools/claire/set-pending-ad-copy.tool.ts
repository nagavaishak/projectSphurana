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
 * Bulk-update headline + caption + description together. Useful when the
 * user asks Claire to "rewrite the ad copy" — saves the model a multi-
 * tool-call sequence. Per-field tools are still preferred for targeted
 * tweaks; this is for full rewrites.
 */
export const setPendingAdCopyTool = defineTool<
  { headline?: string; caption?: string; description?: string },
  DraftAdSnapshot | { error: string }
>({
  feature: 'claire',
  action: 'setPendingAdCopy',
  description:
    'Bulk update the ad copy — headline (max 80), caption / primaryText (max 500), and short description (max 30). Use this only for full rewrites; for single-field tweaks use the per-field tools.',
  inputSchema: z.object({
    headline: z.string().min(1).max(80).optional(),
    caption: z.string().min(1).max(500).optional(),
    description: z.string().min(1).max(30).optional(),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Rewriting ad copy' },
  execute: async (input, ctx) => {
    const draft = await getOrCreateDraftAd(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
    });
    if (!draft.success) return { data: { error: draft.error.message } };
    const updated = await updateDraftAd(db, {
      organizationId: ctx.organizationId,
      draftId: draft.data.ad.id,
      update: {
        ...(input.headline ? { headline: input.headline } : {}),
        ...(input.caption ? { primaryText: input.caption } : {}),
        ...(input.description ? { description: input.description } : {}),
      },
    });
    if (!updated.success) return { data: { error: updated.error.message } };
    return { data: adToSnapshot(updated.data.ad, updated.data.serviceIds) };
  },
});
