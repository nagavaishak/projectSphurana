import { readFileSync } from 'node:fs';
import path from 'node:path';
// Imported from the module directly, not the tool-factory barrel: the barrel
// reaches `confirmation.ts` → the database package, which this spec has no
// business booting.
import { ApiFetchError, type ApiFetchFn } from '../tool-factory/api-fetch.js';
import {
  createVideosPort,
  toCreateBlockedReason,
  toRenderBlockedReason,
} from './videos.adapter.js';

const VIDEO_ID = 'v-1';

/**
 * Read the service's message constants from SOURCE rather than importing them.
 *
 * Importing `@borradh-workspace/features/videos` pulls the whole barrel — AI
 * clients, the email package, env validation — into this spec, which is the
 * very fan-out the adapter avoids by copying the two strings. A static read
 * keeps the pin without the dependency.
 */
function serviceMessage(name: string): string {
  const source = readFileSync(
    path.resolve(
      __dirname,
      '../../../../../packages/features/src/videos/services/queue-video-export/queue-video-export.service.ts'
    ),
    'utf8'
  );
  const match = new RegExp(`export const ${name} =\\s*'([^']*)'`).exec(source);
  if (!match) throw new Error(`Could not read ${name} from the service source`);
  return match[1];
}

const failedBrollClipsMessage = serviceMessage('failedBrollClipsMessage');
const pendingBrollClipsMessage = serviceMessage('pendingBrollClipsMessage');

function portWith(apiFetch: jest.Mock) {
  return createVideosPort({
    apiFetch: apiFetch as unknown as ApiFetchFn,
    conversationId: 'conv-1',
  });
}

describe('videos port adapter', () => {
  describe('b-roll message constants', () => {
    // The adapter copies these rather than importing them, so that the tool
    // context does not drag the features/videos barrel into every request.
    // This test is what keeps the copies honest: reword the service message
    // and the corresponding `RenderBlockedReason` would silently degrade to
    // `other`, so fail here instead.
    it('still matches the service messages they were copied from', () => {
      expect(
        toRenderBlockedReason(new Error(failedBrollClipsMessage), VIDEO_ID)
      ).toEqual({ kind: 'b_roll_transcode_failed' });
      expect(
        toRenderBlockedReason(new Error(pendingBrollClipsMessage), VIDEO_ID)
      ).toEqual({ kind: 'b_roll_still_processing' });
    });
  });

  describe('toRenderBlockedReason', () => {
    it('names the current status when the video is past draft', () => {
      expect(
        toRenderBlockedReason(
          new Error('Video cannot be queued. Current status: processing'),
          VIDEO_ID
        )
      ).toEqual({ kind: 'not_a_draft', currentStatus: 'processing' });
    });

    it('carries the incomplete-config detail through', () => {
      expect(
        toRenderBlockedReason(
          new Error('Video configuration is incomplete: missing clips'),
          VIDEO_ID
        )
      ).toEqual({ kind: 'incomplete_config', detail: 'missing clips' });
    });

    it('maps a 404 to video_not_found', () => {
      expect(
        toRenderBlockedReason(new ApiFetchError('Not found', 404), VIDEO_ID)
      ).toEqual({ kind: 'video_not_found', videoId: VIDEO_ID });
    });

    it('keeps an unrecognised 4xx refusal as `other` with the server wording', () => {
      // A wrong `kind` is worse than an unnamed one: it would let a caller
      // state a cause the server never gave.
      expect(
        toRenderBlockedReason(
          new ApiFetchError('Video is not in draft state', 400),
          VIDEO_ID
        )
      ).toEqual({ kind: 'other', message: 'Video is not in draft state' });
    });

    it('separates a server fault from a stated refusal', () => {
      // Callers alert on `server_error` and stay quiet on `other`; collapsing
      // the two is what made ordinary "no, because…" answers page someone.
      expect(
        toRenderBlockedReason(new Error('Queue is unavailable'), VIDEO_ID)
      ).toEqual({ kind: 'server_error', message: 'Queue is unavailable' });
    });
  });

  describe('toCreateBlockedReason', () => {
    const req = { serviceId: 'svc-1' };

    it('detects missing before/after media', () => {
      expect(
        toCreateBlockedReason(
          new Error('No media tagged before or after was found'),
          req
        )
      ).toEqual({
        kind: 'missing_before_after_media',
        missing: ['before', 'after'],
      });
    });

    it('names the offer that could not be found', () => {
      expect(
        toCreateBlockedReason(new Error('Offer not found'), {
          ...req,
          offerId: 'off-9',
        })
      ).toEqual({ kind: 'offer_not_found', offerId: 'off-9' });
    });
  });

  describe('createDraft', () => {
    const created = {
      id: VIDEO_ID,
      title: 'A video',
      draftConfig: {
        bRollClips: [
          { assetId: 'a2', order: 1 },
          { assetId: 'a1', order: 0 },
        ],
      },
    };

    it('returns `draft` — not `queued` — when autoRender is off', async () => {
      const apiFetch = jest.fn().mockResolvedValue(created);
      const result = await portWith(apiFetch).createDraft({
        serviceId: 'svc-1',
      });

      expect(apiFetch).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('draft');
      // Clips come back in render order regardless of response ordering.
      if (result.status === 'draft') {
        expect(result.draft.clipAssetIds).toEqual(['a1', 'a2']);
      }
    });

    it('returns `queued` when the export is accepted — and nothing more', async () => {
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce(created)
        .mockResolvedValueOnce(undefined);
      const result = await portWith(apiFetch).createDraft({
        serviceId: 'svc-1',
        autoRender: true,
      });

      expect(result.status).toBe('queued');
      // The production shape was `{ rendered: true, status: 'queued' }`. There
      // is no field on this union that asserts the render finished.
      expect(JSON.stringify(result)).not.toContain('rendered');
    });

    it('keeps the draft when the render is refused', async () => {
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce(created)
        .mockRejectedValueOnce(new Error(pendingBrollClipsMessage));
      const result = await portWith(apiFetch).createDraft({
        serviceId: 'svc-1',
        autoRender: true,
      });

      // Both facts survive: the draft exists AND the render did not start.
      expect(result.status).toBe('draft_render_refused');
      if (result.status === 'draft_render_refused') {
        expect(result.draft.videoId).toBe(VIDEO_ID);
        expect(result.reason).toEqual({ kind: 'b_roll_still_processing' });
      }
    });

    it('returns `blocked` with no draft when creation itself fails', async () => {
      const apiFetch = jest
        .fn()
        .mockRejectedValueOnce(new Error('Offer not found'));
      const result = await portWith(apiFetch).createDraft({
        serviceId: 'svc-1',
        offerId: 'off-9',
      });

      expect(result).toEqual({
        status: 'blocked',
        reason: { kind: 'offer_not_found', offerId: 'off-9' },
      });
    });
  });

  describe('getStatus', () => {
    it('reports `ready` only when a URL exists', async () => {
      const apiFetch = jest.fn().mockResolvedValue({
        id: VIDEO_ID,
        title: 'A video',
        status: 'ready',
        progress: 100,
        blobUrl: 'https://cdn/v.mp4',
        thumbnailUrl: null,
        durationMs: 12000,
      });

      const result = await portWith(apiFetch).getStatus(VIDEO_ID);
      expect(result).toEqual({
        status: 'ready',
        videoId: VIDEO_ID,
        title: 'A video',
        url: 'https://cdn/v.mp4',
        thumbnailUrl: null,
        durationMs: 12000,
      });
    });

    it('refuses to call a URL-less `ready` row ready', async () => {
      // `{ status: 'ready', blobUrl: null }` was representable before; the
      // union has no such member now, so the adapter must report the truth.
      const apiFetch = jest.fn().mockResolvedValue({
        id: VIDEO_ID,
        title: 'A video',
        status: 'ready',
        progress: 100,
        blobUrl: null,
        thumbnailUrl: null,
        durationMs: null,
      });

      const result = await portWith(apiFetch).getStatus(VIDEO_ID);
      expect(result.status).toBe('failed');
    });

    it('maps a 404 to not_found rather than throwing', async () => {
      const apiFetch = jest
        .fn()
        .mockRejectedValue(new ApiFetchError('Not found', 404));
      expect(await portWith(apiFetch).getStatus(VIDEO_ID)).toEqual({
        status: 'not_found',
        videoId: VIDEO_ID,
      });
    });

    it('does not treat an unrecognised status as success', async () => {
      const apiFetch = jest.fn().mockResolvedValue({
        id: VIDEO_ID,
        title: 'A video',
        status: 'something_new',
        progress: null,
        blobUrl: null,
        thumbnailUrl: null,
        durationMs: null,
      });
      const result = await portWith(apiFetch).getStatus(VIDEO_ID);
      expect(result.status).toBe('failed');
    });
  });

  describe('patchDraft', () => {
    it('separates "patch landed" from "re-render started"', async () => {
      const apiFetch = jest.fn().mockResolvedValue({
        video: { id: VIDEO_ID, title: 'Updated' },
        rendered: false,
        renderMessage: 'Some selected footage is still processing.',
      });

      const result = await portWith(apiFetch).patchDraft({
        videoId: VIDEO_ID,
        patch: { scriptText: 'x' },
      });

      expect(result.status).toBe('patched_but_blocked');
      if (result.status === 'patched_but_blocked') {
        expect(result.draft.videoId).toBe(VIDEO_ID);
        expect(result.reason).toEqual({
          kind: 'other',
          message: 'Some selected footage is still processing.',
        });
      }
    });

    it('reports no_draft_found instead of inventing a target', async () => {
      const apiFetch = jest.fn().mockResolvedValue({ items: [] });
      expect(
        await portWith(apiFetch).patchDraft({ patch: { scriptText: 'x' } })
      ).toEqual({ status: 'no_draft_found' });
    });
  });
});
