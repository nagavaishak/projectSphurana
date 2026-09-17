import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { AdErrorCodes } from '../../models/index.js';
import { replaceAdCreative } from './replace-ad-creative.service.js';

const query = {
  metaAd: { findFirst: vi.fn() },
  graphic: { findFirst: vi.fn() },
  video: { findFirst: vi.fn() },
  asset: { findFirst: vi.fn() },
};
const returning = vi.fn();
const mockDb = {
  query,
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({ returning })),
    })),
  })),
};

const draft = {
  id: 'ad-1',
  organizationId: 'org-1',
  status: 'draft',
  isImported: false,
  useExistingPost: false,
  metaAdId: null,
  videoId: 'video-old',
  graphicId: null,
};

describe('replaceAdCreative', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.metaAd.findFirst.mockResolvedValue(draft);
    query.graphic.findFirst.mockResolvedValue({ id: 'graphic-new' });
    query.video.findFirst.mockResolvedValue({ id: 'video-new' });
    returning.mockResolvedValue([
      { ...draft, videoId: null, graphicId: 'graphic-new' },
    ]);
  });

  it('requires exactly one creative', async () => {
    const result = await replaceAdCreative(mockDb as never, {
      adId: 'ad-1',
      organizationId: 'org-1',
    });
    expect(result.success).toBe(false);
  });

  it('replaces the creative on the same draft row', async () => {
    const result = await replaceAdCreative(mockDb as never, {
      adId: 'ad-1',
      organizationId: 'org-1',
      graphicId: 'graphic-new',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('ad-1');
      expect(result.data.videoId).toBeNull();
      expect(result.data.graphicId).toBe('graphic-new');
    }
  });

  it.each([
    { status: 'active' },
    { status: 'pending' },
    { status: 'paused' },
    { status: 'rejected' },
    { status: 'launching' },
    { status: 'draft', isImported: true },
    { status: 'draft', useExistingPost: true },
  ])('rejects an ineligible ad: %j', async (override) => {
    query.metaAd.findFirst.mockResolvedValue({ ...draft, ...override });
    const result = await replaceAdCreative(mockDb as never, {
      adId: 'ad-1',
      organizationId: 'org-1',
      videoId: 'video-new',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.INVALID_AD_STATE);
    }
  });

  it('does not expose a cross-organization ad', async () => {
    query.metaAd.findFirst.mockResolvedValue({
      ...draft,
      organizationId: 'org-2',
    });
    const result = await replaceAdCreative(mockDb as never, {
      adId: 'ad-1',
      organizationId: 'org-1',
      videoId: 'video-new',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.AD_NOT_FOUND);
    }
  });
});
