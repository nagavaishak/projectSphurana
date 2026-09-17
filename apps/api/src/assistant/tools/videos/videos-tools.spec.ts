import {
  createMobileUploadTokenResponseSchema,
  getVideoResponseSchema,
} from '@borradh-workspace/contracts';
import { buildAssistantPorts } from '../../ports/index.js';
import { createToolCallCounter } from '../../tool-factory/tool-call-limit.js';
import type { AssistantToolsContext } from '../../tool-factory/types.js';
import { autoSelectClipsTool } from './auto-select-clips.tool.js';
import { autoSelectMusicTool } from './auto-select-music.tool.js';
import { deleteDraftVideoTool } from './delete-draft-video.tool.js';
import { generateTalkingHeadQRTool } from './generate-talking-head-qr.tool.js';
import { generateVideoScriptTool } from './generate-video-script.tool.js';
import { getVideoStatusTool } from './get-video-status.tool.js';
import { videosTools } from './index.js';
import { listDraftClipsTool } from './list-draft-clips.tool.js';

jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
  logWarning: jest.fn(),
  isPostHogInitialized: () => false,
  isSentryInitialized: () => false,
  trackEvent: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

// Short-circuit the database barrel — same reason as the appointments / leads
// / ads spec files. The factory's confirmation.ts module is the only thing
// that imports `db`; `buildCtx` overrides createConfirmation /
// verifyConfirmation so that path is never reached.
jest.mock('@borradh-workspace/database', () => ({ db: {} }));
// `createDraftVideoTool` reaches the item layer directly rather than through
// `apiFetch`, to stamp the card with the cut it belongs to.
jest.mock('@borradh-workspace/features/content-items', () => ({
  // Defaults to SUCCESS: `createDraftVideoTool` opens an item on every draft
  // it creates, so an unimplemented mock would fail every create test for a
  // reason that has nothing to do with what those tests assert.
  ensureItemForAsset: jest
    .fn()
    .mockResolvedValue({ success: true, data: { itemId: 'item-1' } }),
}));
jest.mock('@borradh-workspace/features/content-batches', () => ({
  // Defaults to a SUCCESSFUL empty read. `createDraftVideoTool` calls this to
  // stamp its card with the attempt it belongs to, so an unimplemented mock
  // returns `undefined` and the `.catch()` on it throws — failing every create
  // test for a reason unrelated to what they assert.
  listBatchItemClips: jest.fn().mockResolvedValue({
    success: true,
    data: {
      clips: [],
      pendingRelist: false,
      textChanges: [],
      hasStagedEdits: false,
      renderCount: 0,
      attemptId: 'attempt-1',
    },
  }),
}));
jest.mock('@borradh-workspace/features/assistant', () => ({
  createConfirmationToken: jest.fn(),
  verifyConfirmationToken: jest.fn(),
  // generateVideoScriptTool runs `noFabricatedResultClaims` against the
  // returned script. Default to no failures; specific tests override.
  validateGeneratedCopy: jest.fn(() => []),
}));

interface CtxOverrides {
  apiFetch?: AssistantToolsContext['apiFetch'];
  buildApiFetch?: AssistantToolsContext['buildApiFetch'];
  callCounter?: { count: number; max: number };
  createConfirmation?: AssistantToolsContext['createConfirmation'];
  verifyConfirmation?: AssistantToolsContext['verifyConfirmation'];
  runHardBlocks?: AssistantToolsContext['runHardBlocks'];
  cdnUrl?: string;
  appUrl?: string;
}

function buildCtx(overrides: CtxOverrides = {}): AssistantToolsContext {
  const apiFetch = overrides.apiFetch ?? (jest.fn() as never);
  return {
    organizationId: 'org-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    apiFetch,
    buildApiFetch: overrides.buildApiFetch ?? jest.fn(() => apiFetch),
    // Ports are composed over the SAME mocked apiFetch, so every existing
    // assertion about which paths a tool hits still holds — only the shape the
    // tool returns changed.
    ports: buildAssistantPorts({ apiFetch, conversationId: 'conv-1' }),
    callCounter: overrides.callCounter ?? createToolCallCounter(50),
    runHardBlocks:
      overrides.runHardBlocks ??
      (jest.fn(async () => ({ pass: true })) as never),
    createConfirmation:
      overrides.createConfirmation ??
      (jest.fn(async () => ({
        id: 'token-vid',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      })) as never),
    verifyConfirmation:
      overrides.verifyConfirmation ??
      (jest.fn(async () => ({ valid: true, payload: null })) as never),
    cdnUrl: overrides.cdnUrl,
    appUrl: overrides.appUrl,
  };
}

const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const SERVICE_ID = '22222222-2222-4222-8222-222222222222';

describe('videos tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registry', () => {
    // 13. What left: `patchDraftVideo` and `editVideoClips` are both
    // `content_patchContent` now, and `createDraftVideo` is
    // `content_createContent` — all three addressed by the POST rather than by
    // the video, because an edit forks the video and the post is what follows
    // the fork.
    it('exports 8 tools', () => {
      expect(videosTools).toHaveLength(8);
    });

    it('every tool name uses the videos_ prefix', () => {
      for (const tool of videosTools) {
        expect(tool.name).toMatch(/^videos_/);
        expect(tool.feature).toBe('videos');
      }
    });

    it('only deleteDraftVideo is destructive — render flow uses the queue/execute two-tool split (W-C10 D-1)', () => {
      for (const tool of videosTools) {
        if (tool.name === 'videos_deleteDraftVideo') {
          expect(tool.destructive).toBe(true);
        } else {
          expect(tool.destructive).toBe(false);
        }
      }
    });
  });

  describe('generateVideoScriptTool', () => {
    it('POSTs generate-script then PUTs the resulting script back to the draft', async () => {
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce({ scriptText: 'A natural-looking treatment.' })
        .mockResolvedValueOnce(undefined);
      const result = await generateVideoScriptTool.execute(
        {
          videoId: VIDEO_ID,
          templateId: 'educational',
          variationId: 'educational-1',
          serviceId: SERVICE_ID,
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).toHaveBeenCalledTimes(2);
      const [genPath] = apiFetch.mock.calls[0] as [string];
      expect(genPath).toBe('videos/generate-script');
      const [putPath, putOpts] = apiFetch.mock.calls[1] as [
        string,
        { method?: string },
      ];
      expect(putPath).toBe(`videos/${VIDEO_ID}`);
      expect(putOpts.method).toBe('PUT');
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.scriptText).toBe('A natural-looking treatment.');
      }
    });

    it('blocks when the generated script trips noFabricatedResultClaims', async () => {
      const apiFetch = jest.fn().mockResolvedValueOnce({
        scriptText: '99% of clients see results in 7 days.',
      });
      const runHardBlocks = jest.fn(async () => ({
        pass: false,
        code: 'noFabricatedResultClaims',
        message: 'no fabricated claims',
      }));
      const result = await generateVideoScriptTool.execute(
        {
          videoId: VIDEO_ID,
          templateId: 'educational',
          variationId: 'educational-1',
        },
        buildCtx({
          apiFetch: apiFetch as never,
          runHardBlocks: runHardBlocks as never,
        })
      );
      // The PUT should NOT have happened — only the generate POST.
      expect(apiFetch).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'hard_block_violation') {
        expect(result.presentation.code).toBe('noFabricatedResultClaims');
      }
    });
  });

  describe('listDraftClipsTool', () => {
    it('returns flattened tray rows with clipCount aggregate', async () => {
      const apiFetch = jest.fn(async () => ({
        clips: [
          {
            id: 'c1',
            videoId: VIDEO_ID,
            assetId: 'a1',
            source: 'uploaded',
            beatOrder: 0,
            processingStatus: 'ready',
            asset: {
              id: 'a1',
              name: 'procedure.mp4',
              type: 'video',
              duration: 12,
              blobUrl: 'https://s3/a1.mp4',
              thumbnailUrl: null,
              tags: ['procedure'],
            },
          },
          {
            id: 'c2',
            videoId: VIDEO_ID,
            assetId: null,
            source: 'uploaded',
            beatOrder: 1,
            processingStatus: 'uploading',
            asset: null,
          },
        ],
      }));
      const result = await listDraftClipsTool.execute(
        { videoId: VIDEO_ID },
        buildCtx({ apiFetch: apiFetch as never })
      );
      const [calledPath] = apiFetch.mock.calls[0] as [string];
      expect(calledPath).toBe(`videos/${VIDEO_ID}/draft-clips`);
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.clipCount).toBe(2);
        expect(result.data.clips[0]).toMatchObject({
          assetId: 'a1',
          source: 'uploaded',
          processingStatus: 'ready',
          name: 'procedure.mp4',
        });
        expect(result.data.clips[1]).toMatchObject({
          assetId: null,
          processingStatus: 'uploading',
          name: null,
        });
      }
    });

    it('returns empty + soft error when the underlying GET throws', async () => {
      const apiFetch = jest.fn(async () => {
        throw new Error('boom');
      });
      const result = await listDraftClipsTool.execute(
        { videoId: VIDEO_ID },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.clipCount).toBe(0);
        expect(result.data.clips).toEqual([]);
        expect(result.data.error).toContain('boom');
      }
    });
  });

  describe('autoSelectClipsTool', () => {
    it('takes the first N video assets, PUTs bRollClips, and persists tray rows (W-C10-clip-tray)', async () => {
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce([
          { id: 'a1', name: '1', type: 'video', duration: 4, blobUrl: null },
          { id: 'a2', name: '2', type: 'video', duration: 5, blobUrl: null },
          { id: 'a3', name: '3', type: 'video', duration: 6, blobUrl: null },
          { id: 'a4', name: '4', type: 'image', duration: null, blobUrl: null },
        ])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ clips: [] });
      const result = await autoSelectClipsTool.execute(
        {
          videoId: VIDEO_ID,
          serviceId: SERVICE_ID,
          templateId: 'educational',
          count: 2,
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      // 1) GET assets/by-service, 2) PUT videos/:id (bRollClips),
      // 3) POST videos/:id/draft-clips (tray persistence).
      expect(apiFetch).toHaveBeenCalledTimes(3);
      const [, putOpts] = apiFetch.mock.calls[1] as [
        string,
        {
          method?: string;
          body?: { draftConfig?: { bRollClips?: unknown[] } };
        },
      ];
      expect(putOpts.method).toBe('PUT');
      expect(putOpts.body?.draftConfig?.bRollClips).toHaveLength(2);
      const [trayPath, trayOpts] = apiFetch.mock.calls[2] as [
        string,
        { method?: string; body?: { clips?: { source?: string }[] } },
      ];
      expect(trayPath).toBe(`videos/${VIDEO_ID}/draft-clips`);
      expect(trayOpts.method).toBe('POST');
      expect(trayOpts.body?.clips?.[0]?.source).toBe('suggested');
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.selectedClips).toHaveLength(2);
        expect(result.data.totalAvailable).toBe(3);
        expect(result.data.trayUpdated).toBe(true);
      }
    });

    it('respects excludeIds + fillToCount and writes source: suggested rows to the tray', async () => {
      const A1_UUID = '33333333-3333-4333-8333-333333333333';
      const A2_UUID = '44444444-4444-4444-8444-444444444444';
      const A3_UUID = '55555555-5555-4555-8555-555555555555';
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: A1_UUID,
            name: 'dropped',
            type: 'video',
            duration: 4,
            blobUrl: null,
          },
          {
            id: A2_UUID,
            name: 'fresh',
            type: 'video',
            duration: 5,
            blobUrl: null,
          },
          {
            id: A3_UUID,
            name: 'extra',
            type: 'video',
            duration: 6,
            blobUrl: null,
          },
        ])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ clips: [] });
      const result = await autoSelectClipsTool.execute(
        {
          videoId: VIDEO_ID,
          serviceId: SERVICE_ID,
          templateId: 'educational',
          excludeIds: [A1_UUID],
          fillToCount: 1,
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      const [, putOpts] = apiFetch.mock.calls[1] as [
        string,
        { body?: { draftConfig?: { bRollClips?: { assetId?: string }[] } } },
      ];
      // A1 was excluded; the next eligible video (A2) gets picked.
      expect(putOpts.body?.draftConfig?.bRollClips?.[0]?.assetId).toBe(A2_UUID);
      expect(putOpts.body?.draftConfig?.bRollClips).toHaveLength(1);
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.selectedClips?.[0]?.assetId).toBe(A2_UUID);
        expect(result.data.excluded).toBe(1);
      }
    });

    it('returns soft error when every eligible asset is already in the tray', async () => {
      const A1_UUID = '33333333-3333-4333-8333-333333333333';
      const apiFetch = jest.fn().mockResolvedValueOnce([
        {
          id: A1_UUID,
          name: 'dropped',
          type: 'video',
          duration: 4,
          blobUrl: null,
        },
      ]);
      const result = await autoSelectClipsTool.execute(
        {
          videoId: VIDEO_ID,
          serviceId: SERVICE_ID,
          templateId: 'educational',
          excludeIds: [A1_UUID],
          fillToCount: 2,
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      // Only the assets list call; nothing PUT or POSTed.
      expect(apiFetch).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.selectedClips).toEqual([]);
        expect(result.data.error).toContain('already in the tray');
      }
    });

    it('returns trayUpdated: false when the draft-clips POST fails (best-effort)', async () => {
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce([
          { id: 'a1', name: '1', type: 'video', duration: 4, blobUrl: null },
        ])
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('tray write failed'));
      const result = await autoSelectClipsTool.execute(
        {
          videoId: VIDEO_ID,
          serviceId: SERVICE_ID,
          templateId: 'educational',
          fillToCount: 1,
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.selectedClips).toHaveLength(1);
        expect(result.data.trayUpdated).toBe(false);
      }
    });

    it('returns soft error + empty selection when the service has no video assets', async () => {
      const apiFetch = jest.fn(async () => [
        {
          id: 'a1',
          name: 'photo',
          type: 'image',
          duration: null,
          blobUrl: null,
        },
      ]);
      const result = await autoSelectClipsTool.execute(
        {
          videoId: VIDEO_ID,
          serviceId: SERVICE_ID,
          templateId: 'educational',
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      // Should have queried but NOT PUT.
      expect(apiFetch).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.selectedClips).toEqual([]);
        expect(result.data.error).toContain('No video assets');
      }
    });
  });

  describe('autoSelectMusicTool', () => {
    it('PUTs the selected track + cdn-prefixed url back to the draft', async () => {
      const apiFetch = jest.fn(async () => undefined);
      const result = await autoSelectMusicTool.execute(
        { videoId: VIDEO_ID, templateId: 'educational' },
        buildCtx({ apiFetch: apiFetch as never, cdnUrl: 'https://cdn' })
      );
      expect(apiFetch).toHaveBeenCalledTimes(1);
      const [, putOpts] = apiFetch.mock.calls[0] as [
        string,
        {
          body?: { draftConfig?: { musicUrl?: string; musicTrackId?: string } };
        },
      ];
      expect(putOpts.body?.draftConfig?.musicUrl).toMatch(/^https:\/\/cdn\//);
      expect(putOpts.body?.draftConfig?.musicTrackId).toBeTruthy();
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.trackId).toBeTruthy();
        expect(result.data.videoId).toBe(VIDEO_ID);
      }
    });
  });

  describe('getVideoStatusTool', () => {
    it('returns the base record when the video is ready', async () => {
      const apiFetch = jest.fn(async () => ({
        id: VIDEO_ID,
        title: 'Video',
        status: 'ready',
        progress: 100,
        blobUrl: 'https://cdn/v.mp4',
        thumbnailUrl: 'https://cdn/v.jpg',
        durationMs: 30000,
      }));
      const result = await getVideoStatusTool.execute(
        { videoId: VIDEO_ID },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.status).toBe('ready');
        expect(result.data.blobUrl).toBe('https://cdn/v.mp4');
      }
    });

    it('falls back to the video record if the job lookup throws while processing', async () => {
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce({
          id: VIDEO_ID,
          title: 'Video',
          status: 'processing',
          progress: 42,
          blobUrl: null,
          thumbnailUrl: null,
          durationMs: null,
        })
        .mockRejectedValueOnce(new Error('job not found'));
      const result = await getVideoStatusTool.execute(
        { videoId: VIDEO_ID },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.status).toBe('processing');
        expect(result.data.progress).toBe(42);
      }
    });
  });

  describe('generateTalkingHeadQRTool', () => {
    it('appends a scoped upload token minted with the draft script', async () => {
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce({ draftConfig: { scriptText: 'Hello there' } })
        .mockResolvedValueOnce({ token: 'tok-abc' });
      const result = await generateTalkingHeadQRTool.execute(
        { videoId: VIDEO_ID },
        buildCtx({
          appUrl: 'https://app.borradh.io',
          apiFetch: apiFetch as never,
        })
      );

      expect(apiFetch).toHaveBeenCalledWith(`videos/${VIDEO_ID}`, {
        schema: getVideoResponseSchema,
      });
      expect(apiFetch).toHaveBeenCalledWith('upload/mobile-token', {
        method: 'POST',
        body: { videoId: VIDEO_ID, scriptText: 'Hello there' },
        schema: createMobileUploadTokenResponseSchema,
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.recordingUrl).toBe(
          `https://app.borradh.io/record/${VIDEO_ID}?uploadToken=tok-abc`
        );
        expect(result.data.videoId).toBe(VIDEO_ID);
      }
    });

    it('falls back to a token-less link when minting fails', async () => {
      const apiFetch = jest
        .fn()
        .mockRejectedValueOnce(new Error('mint failed'));
      const result = await generateTalkingHeadQRTool.execute(
        { videoId: VIDEO_ID },
        buildCtx({
          appUrl: 'https://app.borradh.io',
          apiFetch: apiFetch as never,
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.recordingUrl).toBe(
          `https://app.borradh.io/record/${VIDEO_ID}`
        );
      }
    });
  });

  describe('deleteDraftVideoTool', () => {
    it('allows Claire to delete a completed video after confirmation', async () => {
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce({
          id: VIDEO_ID,
          title: 'Completed video',
          status: 'ready',
        })
        .mockResolvedValueOnce(undefined);
      const result = await deleteDraftVideoTool.execute(
        { videoId: VIDEO_ID, confirmationToken: 'confirmed' },
        buildCtx({
          apiFetch: apiFetch as never,
          verifyConfirmation: jest.fn(async () => ({
            valid: true,
            payload: { videoId: VIDEO_ID },
          })) as never,
        })
      );

      expect(apiFetch).toHaveBeenCalledWith(`videos/${VIDEO_ID}`, {
        method: 'DELETE',
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.deleted).toBe(true);
      }
    });
  });

  // The 4xx over-reporting guards (API-9G / ENG-402) moved with the tools they
  // covered: `executeVideoExport` and `updateDraftConfig` are now
  // `content_renderVideo` and `content_patchContent`. See
  // `../content/content-tools.spec.ts`.
});
