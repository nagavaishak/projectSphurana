import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';

// Stub queueVideoExport with a restored spy so the patch service doesn't try to
// talk to BullMQ. A spy is installed at run time (load-order independent) and
// restored, so it can't leak across the shared worker graph (`isolate: false`).
import * as queueVideoExportModule from '../queue-video-export/queue-video-export.service.js';
import { pendingBrollClipsMessage } from '../queue-video-export/queue-video-export.service.js';
import { patchDraftConfig } from './patch-draft-config.service.js';

let mockQueueExport: MockInstance;

const validDraftConfig = {
  scriptText: 'Original',
  narrationType: 'text_only' as const,
  bRollClips: [],
  captions: {
    enabled: true,
    position: 'bottom' as const,
    fontFamily: 'Inter',
    fontSize: 48,
    textColor: '#FFFFFF',
    highlightColor: '#FFD700',
    backgroundColor: '#000000',
    showBackground: true,
  },
  musicVolume: 0.15,
  outro: {
    businessName: 'Acme',
    ctaText: 'Book Now',
    backgroundOpacity: 0.85,
    backgroundColor: '#000000',
    textColor: '#FFFFFF',
    durationSec: 4,
  },
  orientation: 'portrait' as const,
};

describe('patchDraftConfig', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockQueueExport = vi.spyOn(
      queueVideoExportModule,
      'queueVideoExport'
    ) as unknown as MockInstance;
    // Default stub so no test can fall through to the real BullMQ enqueue.
    mockQueueExport.mockReset();
    mockQueueExport.mockResolvedValue(ok({} as never));
  });

  afterEach(() => {
    mockQueueExport.mockRestore();
  });

  it('merges patch over existing draftConfig and requeues by default', async () => {
    const existing = {
      id: 'v1',
      organizationId: 'org-1',
      title: 'Old',
      status: 'draft',
      draftConfig: validDraftConfig,
    };
    // First select: ownership lookup.
    mockDb.limit.mockResolvedValueOnce([existing]);
    // Update returning row.
    const updatedRow = {
      ...existing,
      draftConfig: { ...validDraftConfig, scriptText: 'New script' },
    };
    mockDb.returning.mockResolvedValueOnce([updatedRow]);
    // queueVideoExport happy path → returns the queued video.
    mockQueueExport.mockResolvedValueOnce(
      ok({ ...updatedRow, status: 'queued' }) as never
    );

    const result = await patchDraftConfig(mockDb as never, {
      videoId: 'v1',
      organizationId: 'org-1',
      patch: { scriptText: 'New script' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rendered).toBe(true);
      expect(result.data.video.status).toBe('queued');
    }
    expect(mockQueueExport).toHaveBeenCalledTimes(1);
  });

  it('skips re-render when requeueRender is false', async () => {
    const existing = {
      id: 'v1',
      organizationId: 'org-1',
      status: 'draft',
      draftConfig: validDraftConfig,
    };
    mockDb.limit.mockResolvedValueOnce([existing]);
    mockDb.returning.mockResolvedValueOnce([
      { ...existing, draftConfig: validDraftConfig },
    ]);

    const result = await patchDraftConfig(mockDb as never, {
      videoId: 'v1',
      organizationId: 'org-1',
      patch: { scriptText: 'patched' },
      requeueRender: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rendered).toBe(false);
    }
    expect(mockQueueExport).not.toHaveBeenCalled();
  });

  it('marks an already-rendered video as draft when a config edit defers rendering', async () => {
    const existing = {
      id: 'v1',
      organizationId: 'org-1',
      status: 'ready',
      progress: 100,
      draftConfig: validDraftConfig,
    };
    mockDb.limit.mockResolvedValueOnce([existing]);
    mockDb.returning.mockResolvedValueOnce([
      {
        ...existing,
        status: 'draft',
        progress: 0,
        draftConfig: { ...validDraftConfig, scriptText: 'patched' },
      },
    ]);

    const result = await patchDraftConfig(mockDb as never, {
      videoId: 'v1',
      organizationId: 'org-1',
      patch: { scriptText: 'patched' },
      requeueRender: false,
    });

    expect(result.success).toBe(true);
    const setArg = mockDb.set.mock.calls[0]?.[0] as {
      status?: string;
      progress?: number;
    };
    expect(setArg.status).toBe('draft');
    expect(setArg.progress).toBe(0);
    expect(mockQueueExport).not.toHaveBeenCalled();
  });

  it('keeps a saved patch when its clips are still processing', async () => {
    const existing = {
      id: 'v1',
      organizationId: 'org-1',
      status: 'draft',
      draftConfig: validDraftConfig,
    };
    const updated = {
      ...existing,
      draftConfig: { ...validDraftConfig, scriptText: 'patched' },
    };
    mockDb.limit.mockResolvedValueOnce([existing]);
    mockDb.returning.mockResolvedValueOnce([updated]);
    mockQueueExport.mockResolvedValueOnce(
      err(
        new FeatureError(ErrorCodes.INVALID_STATE, pendingBrollClipsMessage)
      ) as never
    );

    const result = await patchDraftConfig(mockDb as never, {
      videoId: 'v1',
      organizationId: 'org-1',
      patch: { scriptText: 'patched' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rendered).toBe(false);
      expect(result.data.renderMessage).toContain('changes were saved');
    }
  });

  it('deep-merges an offerCard copy patch, preserving price and untouched copy', async () => {
    // An offer video whose on-screen copy Claire is asked to edit.
    const offerDraft = {
      ...validDraftConfig,
      offerCard: {
        serviceName: 'Signature Facial',
        headline: 'Old headline',
        ctaText: 'Book now',
        bulletPoints: ['Deep clean', 'Glow boost'],
        originalPriceCents: 30000,
        offerPriceCents: 19900,
        primaryColor: '#111111',
      },
    };
    const existing = {
      id: 'v1',
      organizationId: 'org-1',
      status: 'draft',
      draftConfig: offerDraft,
    };
    mockDb.limit.mockResolvedValueOnce([existing]);
    mockDb.returning.mockResolvedValueOnce([existing]);

    // Patch ONLY the headline — the rest of the offer card must survive.
    const result = await patchDraftConfig(mockDb as never, {
      videoId: 'v1',
      organizationId: 'org-1',
      patch: { offerCard: { headline: 'New headline' } },
      requeueRender: false,
    });

    expect(result.success).toBe(true);
    const setArg = mockDb.set.mock.calls[0]?.[0] as {
      draftConfig: typeof offerDraft;
    };
    expect(setArg.draftConfig.offerCard).toEqual({
      serviceName: 'Signature Facial',
      headline: 'New headline',
      ctaText: 'Book now',
      bulletPoints: ['Deep clean', 'Glow boost'],
      originalPriceCents: 30000,
      offerPriceCents: 19900,
      primaryColor: '#111111',
    });
  });

  it('returns NOT_FOUND when the video does not exist for that org', async () => {
    mockDb.limit.mockResolvedValueOnce([]);

    await expectResult(
      patchDraftConfig(mockDb as never, {
        videoId: 'v-missing',
        organizationId: 'org-1',
        patch: { scriptText: 'x' },
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns INVALID_STATE when video is mid-render', async () => {
    mockDb.limit.mockResolvedValueOnce([
      {
        id: 'v1',
        organizationId: 'org-1',
        status: 'processing',
        draftConfig: validDraftConfig,
      },
    ]);

    await expectResult(
      patchDraftConfig(mockDb as never, {
        videoId: 'v1',
        organizationId: 'org-1',
        patch: { scriptText: 'x' },
      })
    ).toFailWithCode(ErrorCodes.INVALID_STATE);
    expect(mockQueueExport).not.toHaveBeenCalled();
  });

  it('returns INVALID_STATE when the video has no existing draftConfig', async () => {
    mockDb.limit.mockResolvedValueOnce([
      {
        id: 'v1',
        organizationId: 'org-1',
        status: 'draft',
        draftConfig: null,
      },
    ]);

    await expectResult(
      patchDraftConfig(mockDb as never, {
        videoId: 'v1',
        organizationId: 'org-1',
        patch: { scriptText: 'x' },
      })
    ).toFailWithCode(ErrorCodes.INVALID_STATE);
  });

  it('returns VALIDATION_ERROR for missing videoId', async () => {
    await expectResult(
      patchDraftConfig(mockDb as never, {
        videoId: '',
        organizationId: 'org-1',
        patch: { scriptText: 'x' },
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  // ── copy-on-write ──────────────────────────────────────────────────────
  //
  // Editing a video that has already been RENDERED used to merge in place and
  // re-render over blobUrl, destroying the only copy of the cut the owner
  // watched and approved. `preserveRendered` forks instead.

  describe('preserveRendered', () => {
    const rendered = {
      id: 'v1',
      organizationId: 'org-1',
      createdById: 'user-1',
      title: 'Old',
      // status is 'draft' ON PURPOSE: a previous patch resets it while leaving
      // the render's URL in place, which is exactly why blobUrl and not status
      // is the discriminator.
      status: 'draft',
      blobUrl: 'https://cdn/old.mp4',
      thumbnailUrl: 'https://cdn/old.jpg',
      durationMs: 12_000,
      exportedAt: new Date('2026-08-02T15:47:00Z'),
      schemaVersion: 1,
      usageType: 'organic',
      serviceId: 'svc-1',
      offerId: null,
      templateId: 'myth-fact',
      variationId: 'myth-fact-1',
      synthesisSeed: 4242,
      draftConfig: validDraftConfig,
    };

    it('forks into a new video and leaves the rendered one untouched', async () => {
      mockDb.limit.mockResolvedValueOnce([rendered]);
      mockDb.returning.mockResolvedValueOnce([
        { ...rendered, id: 'v2', blobUrl: null },
      ]);
      mockQueueExport.mockResolvedValueOnce(
        ok({ id: 'v2', status: 'queued' }) as never
      );

      const result = await patchDraftConfig(mockDb as never, {
        videoId: 'v1',
        organizationId: 'org-1',
        patch: {
          mythFact: { pairs: [{ myth: 'Old', fact: 'New' }] },
        } as never,
        preserveRendered: true,
      });

      const data = await expectResult(result).toSucceedWith();
      expect(data.forkedFromVideoId).toBe('v1');
      expect(data.video.id).toBe('v2');
      // The original is never written to.
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.insert).toHaveBeenCalled();
      // The render is queued against the FORK.
      expect(mockQueueExport).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: expect.not.stringMatching(/^v1$/) })
      );
    });

    it('carries the synthesis seed so the fork re-renders the same way', async () => {
      mockDb.limit.mockResolvedValueOnce([rendered]);
      mockDb.returning.mockResolvedValueOnce([{ ...rendered, id: 'v2' }]);

      await patchDraftConfig(mockDb as never, {
        videoId: 'v1',
        organizationId: 'org-1',
        patch: {
          mythFact: { pairs: [{ myth: 'Old', fact: 'New' }] },
        } as never,
        preserveRendered: true,
      });

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          synthesisSeed: 4242,
          templateId: 'myth-fact',
          variationId: 'myth-fact-1',
        })
      );
    });

    it('does not inherit the previous render, which it has not produced yet', async () => {
      mockDb.limit.mockResolvedValueOnce([rendered]);
      mockDb.returning.mockResolvedValueOnce([{ ...rendered, id: 'v2' }]);

      await patchDraftConfig(mockDb as never, {
        videoId: 'v1',
        organizationId: 'org-1',
        patch: {
          mythFact: { pairs: [{ myth: 'Old', fact: 'New' }] },
        } as never,
        preserveRendered: true,
      });

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          blobUrl: null,
          thumbnailUrl: null,
          durationMs: null,
          exportedAt: null,
          status: 'draft',
          progress: 0,
        })
      );
    });

    // The wizard patches an unrendered draft on every interaction. Forking
    // there would mint a video row for a cut nobody has ever seen.
    it('patches in place when there is no rendered cut to protect', async () => {
      const unrendered = { ...rendered, blobUrl: null, exportedAt: null };
      mockDb.limit.mockResolvedValueOnce([unrendered]);
      mockDb.returning.mockResolvedValueOnce([unrendered]);

      const result = await patchDraftConfig(mockDb as never, {
        videoId: 'v1',
        organizationId: 'org-1',
        patch: {
          mythFact: { pairs: [{ myth: 'Old', fact: 'New' }] },
        } as never,
        preserveRendered: true,
      });

      const data = await expectResult(result).toSucceedWith();
      expect(data.forkedFromVideoId).toBeUndefined();
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    // Cloning a row and spending a render to reproduce the same frames is
    // worse than doing nothing, and it would make the attempt history read as
    // though the owner asked for a change they never got.
    it('does not fork on a patch that changes nothing', async () => {
      mockDb.limit.mockResolvedValueOnce([rendered]);
      mockDb.returning.mockResolvedValueOnce([rendered]);

      const result = await patchDraftConfig(mockDb as never, {
        videoId: 'v1',
        organizationId: 'org-1',
        patch: {},
        preserveRendered: true,
      });

      await expectResult(result).toSucceedWith();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('leaves the default OFF, so existing callers still patch in place', async () => {
      mockDb.limit.mockResolvedValueOnce([rendered]);
      mockDb.returning.mockResolvedValueOnce([rendered]);

      await patchDraftConfig(mockDb as never, {
        videoId: 'v1',
        organizationId: 'org-1',
        patch: {
          mythFact: { pairs: [{ myth: 'Old', fact: 'New' }] },
        } as never,
      });

      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  // Bug: a valid field that this video's template does not read. The write
  // succeeds, a render is spent, and nothing on screen moves.
  it('refuses a patch whose every key this template ignores', async () => {
    mockDb.limit.mockResolvedValueOnce([
      {
        id: 'v1',
        organizationId: 'org-1',
        status: 'draft',
        variationId: 'myth-fact-1',
        draftConfig: { ...validDraftConfig, narrationType: 'text_only' },
      },
    ]);

    const result = await patchDraftConfig(mockDb as never, {
      videoId: 'v1',
      organizationId: 'org-1',
      patch: { scriptText: 'MYTH: … FACT: …' },
    });

    await expectResult(result).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(error.message).toContain('mythFact');
    });
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockQueueExport).not.toHaveBeenCalled();
  });

  it('allows the patch once it names the key the template renders from', async () => {
    const existing = {
      id: 'v1',
      organizationId: 'org-1',
      status: 'draft',
      variationId: 'myth-fact-1',
      draftConfig: { ...validDraftConfig, narrationType: 'text_only' },
    };
    mockDb.limit.mockResolvedValueOnce([existing]);
    mockDb.returning.mockResolvedValueOnce([existing]);

    const result = await patchDraftConfig(mockDb as never, {
      videoId: 'v1',
      organizationId: 'org-1',
      patch: {
        mythFact: { pairs: [{ myth: 'You do not', fact: 'You might not' }] },
      } as never,
    });

    await expectResult(result).toSucceedWith();
  });

  // The clip list editor's operation. Not part of the wire contract Claire
  // validates against — a model producing a whole clip list is the failure
  // named operations exist to prevent — but the card CAN send one, because it
  // renders the stored list and hands the same list back.
  describe('replace-all clip operations', () => {
    const withClips = (bRollClips: unknown[]) => ({
      id: 'v1',
      organizationId: 'org-1',
      status: 'draft',
      draftConfig: { ...validDraftConfig, bRollClips },
    });

    const patchedClips = async (bRollClips: unknown[], assetIds: string[]) => {
      const existing = withClips(bRollClips);
      mockDb.limit.mockResolvedValueOnce([existing]);
      mockDb.returning.mockResolvedValueOnce([existing]);

      const result = await patchDraftConfig(mockDb as never, {
        videoId: 'v1',
        organizationId: 'org-1',
        clipOperations: [{ op: 'replace-all', assetIds }],
        requeueRender: false,
      });

      expect(result.success).toBe(true);
      const setArg = mockDb.set.mock.calls[0]?.[0] as {
        draftConfig?: { bRollClips?: { assetId: string; order: number }[] };
      };
      return setArg.draftConfig?.bRollClips ?? [];
    };

    it('reorders the stored list and renumbers order to match', async () => {
      const clips = await patchedClips(
        [
          { assetId: 'a', order: 0 },
          { assetId: 'b', order: 1 },
          { assetId: 'c', order: 2 },
        ],
        ['c', 'a', 'b']
      );

      expect(clips).toEqual([
        { assetId: 'c', order: 0 },
        { assetId: 'a', order: 1 },
        { assetId: 'b', order: 2 },
      ]);
    });

    // THE reason the operation carries asset ids rather than clip configs. A
    // before/after video whose clips came back as `{assetId, order}` alone
    // would have lost which one was the "before" and would render as anonymous
    // b-roll — a successful render of the wrong video.
    it('carries each surviving clip’s own config through the reorder', async () => {
      const clips = await patchedClips(
        [
          { assetId: 'a', order: 0, clipType: 'before' },
          { assetId: 'b', order: 1, clipType: 'after' },
        ],
        ['b', 'a']
      );

      expect(clips).toEqual([
        { assetId: 'b', order: 0, clipType: 'after' },
        { assetId: 'a', order: 1, clipType: 'before' },
      ]);
    });

    it('drops what the owner removed and admits what they added', async () => {
      const clips = await patchedClips(
        [
          { assetId: 'a', order: 0, clipType: 'bRoll' },
          { assetId: 'b', order: 1, clipType: 'bRoll' },
        ],
        ['a', 'new']
      );

      expect(clips).toEqual([
        { assetId: 'a', order: 0, clipType: 'bRoll' },
        { assetId: 'new', order: 1 },
      ]);
    });

    // A list that legitimately repeats an asset — the planner cycles a
    // service's footage — must keep both configs rather than cloning the first
    // match onto every occurrence.
    it('matches each stored entry once when an asset repeats', async () => {
      const clips = await patchedClips(
        [
          { assetId: 'a', order: 0, clipType: 'before' },
          { assetId: 'a', order: 1, clipType: 'after' },
        ],
        ['a', 'a']
      );

      expect(clips).toEqual([
        { assetId: 'a', order: 0, clipType: 'before' },
        { assetId: 'a', order: 1, clipType: 'after' },
      ]);
    });
  });
});
