import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import * as regenerateGraphicModule from '../../../graphics/services/regenerate-graphic/regenerate-graphic.service.js';
// Spy the SOURCE modules, not their barrels: barrel re-exports are live getters
// under Vite SSR and cannot be redefined.
import { ErrorCodes, FeatureError } from '../../../shared/index.js';
import * as patchDraftConfigModule from '../../../videos/services/patch-draft-config/patch-draft-config.service.js';
import * as ensureItemModule from '../ensure-item-for-asset/ensure-item-for-asset.js';
import * as recordAttemptModule from '../record-attempt/record-attempt.js';
import { reviseContent } from './revise-content.js';

const ORG = 'org_1';
const db = {} as never;

/** The video half's input. The graphic half keeps its own, below. */
const input = {
  videoId: 'video_old',
  organizationId: ORG,
  patch: {} as never,
  requeueRender: true,
  refinementInstruction:
    'change "you don\'t need a patch test" to "you might not"',
};

const okItem = (itemId = 'item_1') =>
  vi
    .spyOn(ensureItemModule, 'ensureItemForAsset')
    .mockResolvedValue({ success: true, data: { itemId, adopted: false } });

const patchResult = (data: Record<string, unknown>) =>
  vi
    .spyOn(patchDraftConfigModule, 'patchDraftConfig')
    .mockResolvedValue({ success: true, data } as never);

const okAttempt = (attemptNumber = 1) =>
  vi.spyOn(recordAttemptModule, 'recordAttempt').mockResolvedValue({
    success: true,
    data: { attemptNumber },
  } as never);

describe('reviseContent — video', () => {
  beforeEach(() => vi.restoreAllMocks());

  // The whole point of Phase 4: editing a rendered video must not destroy it.
  it('forces preserveRendered on, so a rendered cut is never overwritten', async () => {
    okItem();
    const patch = patchResult({
      video: { id: 'video_fork' },
      rendered: true,
      forkedFromVideoId: 'video_old',
    });
    okAttempt();

    await reviseContent(db, { kind: 'video', ...input });

    expect(patch).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ preserveRendered: true })
    );
  });

  it('records the fork as the next attempt, carrying the instruction', async () => {
    okItem('item_1');
    patchResult({
      video: { id: 'video_fork' },
      rendered: true,
      forkedFromVideoId: 'video_old',
    });
    const record = okAttempt(2);

    const result = await reviseContent(db, { kind: 'video', ...input });

    const data = await expectResult(result).toSucceedWith();
    expect(data).toMatchObject({ itemId: 'item_1', attemptNumber: 2 });
    expect(record).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        itemId: 'item_1',
        // The FORK, not the video that was edited.
        videoId: 'video_fork',
        reason: input.refinementInstruction,
      })
    );
  });

  // An unrendered draft has no previous cut to supersede, so an edit to it is
  // not a new version — recording one would inflate the history with versions
  // that never existed.
  it('does not record an attempt when the patch edited an unrendered draft', async () => {
    okItem('item_1');
    patchResult({ video: { id: 'video_old' }, rendered: true });
    const record = okAttempt();

    const result = await reviseContent(db, { kind: 'video', ...input });

    const data = await expectResult(result).toSucceedWith();
    expect(data).toMatchObject({ itemId: 'item_1', attemptNumber: -1 });
    expect(record).not.toHaveBeenCalled();
  });

  it('opens the item BEFORE the patch touches anything', async () => {
    const order: string[] = [];
    vi.spyOn(ensureItemModule, 'ensureItemForAsset').mockImplementation(
      async () => {
        order.push('ensureItem');
        return { success: true, data: { itemId: 'item_1', adopted: true } };
      }
    );
    vi.spyOn(patchDraftConfigModule, 'patchDraftConfig').mockImplementation(
      (async () => {
        order.push('patch');
        return {
          success: true,
          data: {
            video: { id: 'video_fork' },
            rendered: true,
            forkedFromVideoId: 'video_old',
          },
        };
      }) as never
    );
    okAttempt();

    await reviseContent(db, { kind: 'video', ...input });

    expect(order).toEqual(['ensureItem', 'patch']);
  });

  it('does not patch when the item cannot be opened', async () => {
    vi.spyOn(ensureItemModule, 'ensureItemForAsset').mockResolvedValue({
      success: false,
      error: new FeatureError(ErrorCodes.INTERNAL_ERROR, 'nope'),
    });
    const patch = patchResult({ video: { id: 'x' }, rendered: false });

    const result = await reviseContent(db, { kind: 'video', ...input });

    await expectResult(result).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it('surfaces a patch failure rather than recording an attempt for it', async () => {
    okItem();
    vi.spyOn(patchDraftConfigModule, 'patchDraftConfig').mockResolvedValue({
      success: false,
      error: new FeatureError(ErrorCodes.NOT_FOUND, 'Video not found'),
    } as never);
    const record = okAttempt();

    const result = await reviseContent(db, { kind: 'video', ...input });

    await expectResult(result).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
    });
    expect(record).not.toHaveBeenCalled();
  });

  // The fork exists and its render is queued by this point.
  it('still reports the fork when the attempt write fails', async () => {
    okItem();
    patchResult({
      video: { id: 'video_fork' },
      rendered: true,
      forkedFromVideoId: 'video_old',
    });
    vi.spyOn(recordAttemptModule, 'recordAttempt').mockResolvedValue({
      success: false,
      error: new FeatureError(ErrorCodes.CONFLICT, 'raced'),
    } as never);

    const result = await reviseContent(db, { kind: 'video', ...input });

    const data = await expectResult(result).toSucceedWith();
    expect(data.video.id).toBe('video_fork');
    expect(data.attemptNumber).toBe(-1);
  });

  it('does not leak its own keys into the patch call', async () => {
    okItem();
    const patch = patchResult({
      video: { id: 'video_fork' },
      rendered: true,
      forkedFromVideoId: 'video_old',
    });
    okAttempt();

    await reviseContent(db, {
      kind: 'video',
      ...input,
      source: 'content_studio',
    });

    const sent = patch.mock.calls[0][1] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('source');
    expect(sent).not.toHaveProperty('refinementInstruction');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The same three steps, the other kind. Both halves live in one file because
// the SERVICE is one: the bookkeeping (ensure → produce → record) is shared,
// and a test file per kind is how the two drifted in the first place.
// ─────────────────────────────────────────────────────────────────────────

describe('reviseContent — graphic', () => {
  beforeEach(() => vi.restoreAllMocks());

  const graphicInput = {
    organizationId: ORG,
    graphicId: 'graphic_old',
    createdById: 'user_1',
    refinementInstruction:
      'change "no mascara needed" to "you can still wear mascara"',
  };

  const okRender = (id = 'graphic_new') =>
    vi
      .spyOn(regenerateGraphicModule, 'regenerateGraphic')
      .mockResolvedValue({ success: true, data: { id } } as never);

  it('records the re-roll as the next attempt, carrying the instruction', async () => {
    okItem('item_1');
    okRender('graphic_new');
    const record = okAttempt(3);

    const result = await reviseContent(db, {
      kind: 'graphic',
      ...graphicInput,
    });

    const data = await expectResult(result).toSucceedWith();
    expect(data).toMatchObject({ itemId: 'item_1', attemptNumber: 3 });
    expect(data.graphic.id).toBe('graphic_new');
    expect(record).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        itemId: 'item_1',
        organizationId: ORG,
        // The NEW graphic, not the one being edited.
        graphicId: 'graphic_new',
        reason: graphicInput.refinementInstruction,
      })
    );
  });

  // The item has to exist before a render is queued, or a render can start with
  // nothing recording why — the exact state this change exists to end.
  it('opens the item BEFORE queueing the render', async () => {
    const order: string[] = [];
    vi.spyOn(ensureItemModule, 'ensureItemForAsset').mockImplementation(
      async () => {
        order.push('ensureItem');
        return { success: true, data: { itemId: 'item_1', adopted: true } };
      }
    );
    vi.spyOn(regenerateGraphicModule, 'regenerateGraphic').mockImplementation(
      (async () => {
        order.push('regenerate');
        return { success: true, data: { id: 'graphic_new' } };
      }) as never
    );
    okAttempt();

    await reviseContent(db, { kind: 'graphic', ...graphicInput });

    expect(order).toEqual(['ensureItem', 'regenerate']);
  });

  it('does not render when the item cannot be opened', async () => {
    vi.spyOn(ensureItemModule, 'ensureItemForAsset').mockResolvedValue({
      success: false,
      error: new FeatureError(ErrorCodes.INTERNAL_ERROR, 'nope'),
    });
    const render = okRender();

    const result = await reviseContent(db, {
      kind: 'graphic',
      ...graphicInput,
    });

    await expectResult(result).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    });
    expect(render).not.toHaveBeenCalled();
  });

  it('surfaces a render failure rather than recording an attempt for it', async () => {
    okItem();
    vi.spyOn(regenerateGraphicModule, 'regenerateGraphic').mockResolvedValue({
      success: false,
      error: new FeatureError(ErrorCodes.NOT_FOUND, 'Graphic not found'),
    } as never);
    const record = okAttempt();

    const result = await reviseContent(db, {
      kind: 'graphic',
      ...graphicInput,
    });

    await expectResult(result).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
    });
    expect(record).not.toHaveBeenCalled();
  });

  // The render is queued and the new graphic row exists by this point. Failing
  // would tell the owner their edit did not happen while it demonstrably did.
  it('still reports the graphic when the attempt write fails', async () => {
    okItem('item_1');
    okRender('graphic_new');
    vi.spyOn(recordAttemptModule, 'recordAttempt').mockResolvedValue({
      success: false,
      error: new FeatureError(ErrorCodes.CONFLICT, 'raced'),
    } as never);

    const result = await reviseContent(db, {
      kind: 'graphic',
      ...graphicInput,
    });

    const data = await expectResult(result).toSucceedWith();
    expect(data.graphic.id).toBe('graphic_new');
    expect(data.attemptNumber).toBe(-1);
  });

  it('passes the regenerate input through without the source key', async () => {
    okItem();
    const render = okRender();
    okAttempt();

    await reviseContent(db, {
      kind: 'graphic',
      ...input,
      scope: 'slide',
      slideIndex: 1,
      source: 'content_studio',
    });

    expect(render).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ scope: 'slide', slideIndex: 1 })
    );
    expect(render.mock.calls[0][1]).not.toHaveProperty('source');
  });
});
