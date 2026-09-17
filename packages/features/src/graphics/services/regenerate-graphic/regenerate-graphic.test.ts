import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import { ErrorCodes, ok } from '../../../shared/index.js';
import * as queueGraphicGenerateModule from '../queue-graphic-generate/queue-graphic-generate.service.js';
import { regenerateGraphic } from './regenerate-graphic.service.js';

// Restored `vi.spyOn`, NOT `vi.mock` — under `isolate: false` all files in a
// worker share one module graph, so a hoisted bare-factory mock of an internal
// module leaks outward (deleting the exports it omits) and silently misses
// whenever an earlier file already imported the real module. The service
// imports through the `../queue-graphic-generate/index.js` barrel, whose live
// getters cannot be redefined, so we spy the SOURCE module it forwards to.
const hoisted = {} as { mockQueue: MockInstance };

const createInsertChain = (resolveValue: unknown[]) => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.values = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(resolveValue);
  return chain;
};

let insertChain: ReturnType<typeof createInsertChain>;
const queryFns = {
  graphic: { findFirst: vi.fn() },
  organization: { findFirst: vi.fn() },
};
const mockDb = {
  insert: vi.fn().mockImplementation(() => insertChain),
  update: vi
    .fn()
    .mockReturnValue({ set: () => ({ where: () => Promise.resolve([]) }) }),
  query: queryFns,
};

const base = {
  organizationId: 'org_1',
  graphicId: 'gfx_1',
  createdById: 'user_1',
  refinementInstruction: 'add a blue tint',
};

const carouselSource = {
  id: 'gfx_1',
  organizationId: 'org_1',
  serviceId: 'svc_1',
  topicSummary: 'Glow up',
  kind: 'carousel' as const,
  usageType: 'organic' as const,
  offerId: null,
  sourceAssetIds: ['asset-original'],
  allowAiImages: true,
  title: 'My carousel',
  aspectRatio: '4:5',
  canvasWidth: 1080,
  canvasHeight: 1350,
  templateSlug: 'tmpl-a',
  outputs: [
    { slideOrder: 0, url: 'https://cdn/0.png' },
    { slideOrder: 1, url: 'https://cdn/1.png' },
    { slideOrder: 2, url: 'https://cdn/2.png' },
  ],
};

describe('regenerateGraphic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertChain = createInsertChain([{ id: 'new_gfx', kind: 'carousel' }]);
    queryFns.graphic.findFirst.mockReset();
    queryFns.organization.findFirst.mockReset();
    queryFns.organization.findFirst.mockResolvedValue({ primaryColor: '#abc' });
    hoisted.mockQueue = vi
      .spyOn(queueGraphicGenerateModule, 'queueGraphicGenerate')
      .mockResolvedValue(ok({ jobId: 'job_1' }) as never);
  });

  afterEach(() => {
    hoisted.mockQueue.mockRestore();
  });

  it('returns VALIDATION_ERROR for an empty graphicId', async () => {
    await expectResult(
      regenerateGraphic(mockDb as never, { ...base, graphicId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(hoisted.mockQueue).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the graphic does not exist', async () => {
    queryFns.graphic.findFirst.mockResolvedValueOnce(undefined);
    await expectResult(regenerateGraphic(mockDb as never, base)).toFailWithCode(
      ErrorCodes.NOT_FOUND
    );
  });

  it('requires slideIndex when scope = slide', async () => {
    queryFns.graphic.findFirst.mockResolvedValueOnce(carouselSource);
    await expectResult(
      regenerateGraphic(mockDb as never, { ...base, scope: 'slide' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('rejects slide scope when the source has no pinned template', async () => {
    queryFns.graphic.findFirst.mockResolvedValueOnce({
      ...carouselSource,
      templateSlug: null,
    });
    await expectResult(
      regenerateGraphic(mockDb as never, {
        ...base,
        scope: 'slide',
        slideIndex: 1,
      })
    ).toFailWithCode(ErrorCodes.INVALID_STATE);
  });

  it('refines a single slide: pins template + carries the instruction + priorGraphicId', async () => {
    queryFns.graphic.findFirst.mockResolvedValueOnce(carouselSource);
    await expectResult(
      regenerateGraphic(mockDb as never, {
        ...base,
        scope: 'slide',
        slideIndex: 1,
      })
    ).toSucceedWith(() => {});

    // `scope`/`slideIndex` normalises into the SAME list a per-slide proposal
    // sends, so the worker has one representation to understand rather than
    // two kept in step by hand.
    expect(hoisted.mockQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'render-only',
        templateSlug: 'tmpl-a',
        slideInstructions: [
          { slideIndex: 1, op: 'refine', note: 'add a blue tint' },
        ],
        priorGraphicId: 'gfx_1',
        refinementInstruction: 'add a blue tint',
      })
    );
  });

  it('refines SEVERAL slides, each with its own instruction, in one render', async () => {
    // The carousel refiner already runs one model call per slide, so per-slide
    // instructions cost what amending the whole deck costs — there is no reason
    // to make the owner come back for the second one.
    queryFns.graphic.findFirst.mockResolvedValueOnce(carouselSource);
    await expectResult(
      regenerateGraphic(mockDb as never, {
        ...base,
        slideEdits: [
          { slideIndex: 0, op: 'refine', note: 'shorter headline' },
          { slideIndex: 1, op: 'remove' },
        ],
      })
    ).toSucceedWith(() => {});

    expect(hoisted.mockQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        slideInstructions: [
          { slideIndex: 0, op: 'refine', note: 'shorter headline' },
          { slideIndex: 1, op: 'remove' },
        ],
        priorGraphicId: 'gfx_1',
      })
    );
  });

  it('uses one replacement source image for a targeted slide', async () => {
    queryFns.graphic.findFirst.mockResolvedValueOnce(carouselSource);
    await expectResult(
      regenerateGraphic(mockDb as never, {
        ...base,
        scope: 'slide',
        slideIndex: 1,
        sourceAssetIds: ['asset-new'],
      })
    ).toSucceedWith(() => {});

    expect(hoisted.mockQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAssetIds: ['asset-new'],
        allowAiImages: true,
        usageType: 'organic',
      })
    );
  });

  it('rejects multiple replacement images for a targeted slide', async () => {
    await expectResult(
      regenerateGraphic(mockDb as never, {
        ...base,
        scope: 'slide',
        slideIndex: 1,
        sourceAssetIds: ['asset-1', 'asset-2'],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(queryFns.graphic.findFirst).not.toHaveBeenCalled();
  });

  it('retains paid-ad generation provenance', async () => {
    queryFns.graphic.findFirst.mockResolvedValueOnce({
      ...carouselSource,
      kind: 'single',
      usageType: 'ad',
      offerId: 'offer-1',
    });
    insertChain = createInsertChain([{ id: 'new_gfx', kind: 'single' }]);
    await expectResult(regenerateGraphic(mockDb as never, base)).toSucceedWith(
      () => {}
    );

    expect(hoisted.mockQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        usageType: 'ad',
        offerId: 'offer-1',
        sourceAssetIds: ['asset-original'],
        allowAiImages: true,
      })
    );
  });

  it('degrades a legacy paid-ad graphic without offer provenance to an organic regenerate', async () => {
    queryFns.graphic.findFirst.mockResolvedValueOnce({
      ...carouselSource,
      usageType: 'ad',
      offerId: null,
    });
    await expectResult(
      regenerateGraphic(mockDb as never, { ...base, scope: 'all' })
    ).toSucceedWith(() => {});
    expect(hoisted.mockQueue).toHaveBeenCalled();
    // No offer context to reproduce, so it regenerates as organic rather than
    // dead-ending the owner.
    expect(hoisted.mockQueue.mock.calls[0][0].usageType).toBe('organic');
  });

  it('anchors a whole-carousel refine to the source graphic, with no slideIndex', async () => {
    // THE FIX. This used to assert `priorGraphicId` was undefined, which is
    // precisely why a whole-carousel refine was never an edit: with no anchor
    // the worker recomposed the deck from the curated inspiration image, so
    // "make the headline shorter" returned a different carousel. Carousels are
    // ~40% of graphics.
    //
    // A carousel cannot anchor to `priorImageUrl` the way a single graphic
    // does — that value is `outputs[0].url`, slide 1 and nothing else. It
    // anchors to the SOURCE GRAPHIC so the worker can resolve each slide's own
    // prior image from the preserved `outputs[]`.
    queryFns.graphic.findFirst.mockResolvedValueOnce(carouselSource);
    await expectResult(
      regenerateGraphic(mockDb as never, { ...base, scope: 'all' })
    ).toSucceedWith(() => {});

    const arg = hoisted.mockQueue.mock.calls[0][0];
    expect(arg.templateSlug).toBe('tmpl-a');
    // No slideIndex — that is what distinguishes a whole-deck refine from a
    // single-slide one at the worker.
    expect(arg.slideIndex).toBeUndefined();
    expect(arg.priorGraphicId).toBe('gfx_1');
    // A carousel must NOT carry a single prior image; it would be slide 1
    // masquerading as the deck.
    expect(arg.priorImageUrl).toBeUndefined();
  });

  it('coerces slide scope to a full re-render for single graphics + anchors the prior image', async () => {
    queryFns.graphic.findFirst.mockResolvedValueOnce({
      ...carouselSource,
      kind: 'single',
      outputs: [{ slideOrder: 0, url: 'https://cdn/only.png' }],
    });
    insertChain = createInsertChain([{ id: 'new_gfx', kind: 'single' }]);
    await expectResult(
      regenerateGraphic(mockDb as never, {
        ...base,
        scope: 'slide',
        slideIndex: 0,
      })
    ).toSucceedWith(() => {});

    const arg = hoisted.mockQueue.mock.calls[0][0];
    expect(arg.slideIndex).toBeUndefined();
    expect(arg.priorImageUrl).toBe('https://cdn/only.png');
  });
});
