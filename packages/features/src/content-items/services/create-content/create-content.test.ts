import {
  beforeEach,
  describe,
  expect,
  expectSuccess,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
// Spy the SOURCE modules, not their barrels: barrel re-exports are live getters
// under Vite SSR and cannot be redefined.
import { ErrorCodes, FeatureError } from '../../../shared/index.js';
import * as createVideoModule from '../../../videos/services/create-video-from-request/create-video-from-request.service.js';
import * as attachModule from '../attach-content-asset/attach-content-asset.js';
import * as createGraphicModule from '../create-content-graphic/create-content-graphic.js';
import * as insertSlotModule from '../insert-slot/insert-slot.js';
import { createContent } from './create-content.js';

const ORG = 'org_1';
const db = {} as never;

const videoInput = {
  kind: 'video' as const,
  organizationId: ORG,
  createdById: 'user_1',
  format: 'caption_tease',
  serviceId: 'svc_1',
};

const okVideo = (id = 'video_1') =>
  vi
    .spyOn(createVideoModule, 'createVideoFromRequest')
    .mockResolvedValue({ success: true, data: { id } } as never);

const okSlot = (slotId = 'item_1') =>
  vi
    .spyOn(insertSlotModule, 'insertSlotWithFirstAttempt')
    .mockResolvedValue({ slotId } as never);

describe('createContent — video', () => {
  beforeEach(() => vi.restoreAllMocks());

  // The reason this service exists. `POST /videos` created a video and nothing
  // else, so a video had no item and no way to be edited afterwards without a
  // tool reaching past HTTP to adopt one.
  it('opens a content item for a freshly created video', async () => {
    okVideo('video_1');
    const slot = okSlot('item_1');

    const result = await createContent(db, videoInput);

    const data = expectSuccess(result);
    expect(data.kind).toBe('video');
    expect(data.itemId).toBe('item_1');
    expect(slot).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ kind: 'video', videoId: 'video_1' })
    );
  });

  // A proposal the owner already saw and accepted. Opening a second item here
  // would leave the card stamped with an id that no longer owns the content.
  it('fills an existing proposal instead of opening a second item', async () => {
    okVideo('video_1');
    const attach = vi
      .spyOn(attachModule, 'attachContentAsset')
      .mockResolvedValue({ success: true, data: {} } as never);
    const slot = okSlot();

    const result = await createContent(db, {
      ...videoInput,
      itemId: 'item_existing',
    });

    expect(expectSuccess(result).itemId).toBe('item_existing');
    expect(attach).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ itemId: 'item_existing', videoId: 'video_1' })
    );
    expect(slot).not.toHaveBeenCalled();
  });

  // The video exists and its render is queued by this point. Reporting failure
  // would tell the owner their video was not created while it demonstrably was.
  it('returns the video with a null itemId when the item cannot be opened', async () => {
    okVideo('video_1');
    vi.spyOn(insertSlotModule, 'insertSlotWithFirstAttempt').mockRejectedValue(
      new Error('constraint violation')
    );

    const result = await createContent(db, videoInput);

    const data = expectSuccess(result);
    expect(data.itemId).toBeNull();
    expect(data.kind === 'video' && data.video.id).toBe('video_1');
  });

  // The inverse: no video means there is nothing to own, so the failure is real.
  it('fails when the video itself could not be created', async () => {
    vi.spyOn(createVideoModule, 'createVideoFromRequest').mockResolvedValue({
      success: false,
      error: new FeatureError(ErrorCodes.VALIDATION_ERROR, 'No such template'),
    } as never);
    const slot = okSlot();

    const result = await createContent(db, videoInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(slot).not.toHaveBeenCalled();
  });
});

describe('createContent — graphic', () => {
  beforeEach(() => vi.restoreAllMocks());

  // Delegated whole, so there is exactly one graphic-create path. If this ever
  // starts opening its own item, there are two again and they will drift.
  it('delegates to createContentGraphic and passes the proposal through', async () => {
    const create = vi
      .spyOn(createGraphicModule, 'createContentGraphic')
      .mockResolvedValue({
        success: true,
        data: { graphic: { id: 'graphic_1' }, itemId: 'item_existing' },
      } as never);
    const slot = okSlot();

    const result = await createContent(db, {
      kind: 'graphic',
      organizationId: ORG,
      serviceId: 'svc_1',
      category: 'tips',
      allowAiImages: true,
      allowStockImages: true,
      itemId: 'item_existing',
    } as never);

    expect(expectSuccess(result).itemId).toBe('item_existing');
    expect(create).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        itemId: 'item_existing',
        source: 'claire_chat',
      })
    );
    expect(slot).not.toHaveBeenCalled();
  });

  // `kind` means single-vs-carousel inside graphics and video-vs-graphic out
  // here. The rename is only safe if it is actually mapped back.
  it('maps imageKind back onto the graphic request', async () => {
    const create = vi
      .spyOn(createGraphicModule, 'createContentGraphic')
      .mockResolvedValue({
        success: true,
        data: { graphic: { id: 'graphic_1' }, itemId: 'item_1' },
      } as never);

    await createContent(db, {
      kind: 'graphic',
      organizationId: ORG,
      serviceId: 'svc_1',
      category: 'tips',
      allowAiImages: true,
      allowStockImages: true,
      imageKind: 'carousel',
    } as never);

    expect(create).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ kind: 'carousel' })
    );
  });
});
