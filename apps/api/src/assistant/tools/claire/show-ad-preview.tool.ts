import { db } from '@borradh-workspace/database';
import { getOrCreateDraftAd } from '@borradh-workspace/features/claire';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { adToSnapshot } from './_helpers.js';
import type { PreviewCardPayload } from './types.js';

/**
 * `claire_showAdPreview` — render the ad preview card in the chat.
 *
 * Emits the W7 contract via `presentation`:
 *   { type: 'preview_card', kind: 'ad', draftId, state }
 *
 * Window 7 detects this payload in the chat renderer and mounts its
 * preview component. The `state` snapshot is the source of truth at
 * render-time; the preview component refetches via /meta-ads/:id for
 * subsequent edits.
 */
export const showAdPreviewTool = defineTool<
  Record<string, never>,
  { draftId: string; ready: boolean; missing: string[] }
>({
  feature: 'claire',
  action: 'showAdPreview',
  description:
    'Render the ad preview card in the chat with the current draft state. Call this when you have collected all the user-specific details (service, headline, caption, creative). The card shows the final video/image + editable headline + editable caption + Publish/Save Draft buttons. Do NOT call this before a creative (videoId) is set.',
  inputSchema: z.object({}),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Rendering the ad preview' },
  execute: async (_input, ctx) => {
    const draft = await getOrCreateDraftAd(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
    });
    if (!draft.success) {
      return {
        data: { draftId: '', ready: false, missing: [draft.error.message] },
      };
    }

    const snapshot = adToSnapshot(draft.data.ad, draft.data.serviceIds);

    const missing: string[] = [];
    if (!snapshot.videoId) missing.push('creative');
    if (!snapshot.metaCampaignId) missing.push('campaign');
    if (!snapshot.headline) missing.push('headline');
    if (!snapshot.serviceIds || snapshot.serviceIds.length === 0)
      missing.push('serviceIds');

    const payload: PreviewCardPayload = {
      type: 'preview_card',
      kind: 'ad',
      draftId: draft.data.ad.id,
      state: snapshot as unknown as Record<string, unknown>,
    };

    return {
      data: {
        draftId: draft.data.ad.id,
        ready: missing.length === 0,
        missing,
      },
      presentation: payload,
    };
  },
});
