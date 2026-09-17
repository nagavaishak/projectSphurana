import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { resolveAdReferral } from './resolve-ad-referral.js';

const mockDb = {
  query: {
    metaAd: { findFirst: vi.fn() },
  },
};

describe('resolveAdReferral', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when no referral data', async () => {
    const result = await resolveAdReferral(mockDb as never, undefined);
    expect(result).toBeNull();
  });

  it('returns null when referral has no metaAdId', async () => {
    const result = await resolveAdReferral(mockDb as never, {
      metaAdId: '',
    });
    expect(result).toBeNull();
  });

  it('returns ad metadata when found by metaAdId', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      id: 'internal-ad-1',
    });

    const result = await resolveAdReferral(mockDb as never, {
      metaAdId: 'meta-ad-123',
      adTitle: 'Summer Sale',
    });

    expect(result).toEqual({
      adMetaId: 'meta-ad-123',
      adTitle: 'Summer Sale',
      adInternalId: 'internal-ad-1',
    });
  });

  it('returns metadata without internal ID when ad not found in DB', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);

    const result = await resolveAdReferral(mockDb as never, {
      metaAdId: 'meta-ad-unknown',
      adTitle: 'My Ad',
    });

    expect(result).toEqual({
      adMetaId: 'meta-ad-unknown',
      adTitle: 'My Ad',
    });
    expect(result?.adInternalId).toBeUndefined();
  });

  it('returns metadata without internal ID when DB lookup fails', async () => {
    mockDb.query.metaAd.findFirst.mockRejectedValueOnce(
      new Error('DB connection error')
    );

    const result = await resolveAdReferral(mockDb as never, {
      metaAdId: 'meta-ad-123',
      adTitle: 'My Ad',
    });

    expect(result).toEqual({
      adMetaId: 'meta-ad-123',
      adTitle: 'My Ad',
    });
  });

  it('handles referral without adTitle', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({ id: 'internal-1' });

    const result = await resolveAdReferral(mockDb as never, {
      metaAdId: 'meta-ad-123',
    });

    expect(result).toEqual({
      adMetaId: 'meta-ad-123',
      adTitle: undefined,
      adInternalId: 'internal-1',
    });
  });

  it('handles referral with source field', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);

    const result = await resolveAdReferral(mockDb as never, {
      metaAdId: 'meta-ad-123',
      source: 'some-source',
      adTitle: 'Ad Title',
    });

    expect(result).toEqual({
      adMetaId: 'meta-ad-123',
      adTitle: 'Ad Title',
    });
  });

  // --- Lazy import on miss (onMissingAd callback) -------------------------

  it('uses onMissingAd to resolve adInternalId when the ad is not in the DB', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);
    const onMissingAd = vi.fn().mockResolvedValue('imported-ad-1');

    const result = await resolveAdReferral(
      mockDb as never,
      { metaAdId: 'meta-ad-unknown', adTitle: 'My Ad' },
      { onMissingAd }
    );

    expect(onMissingAd).toHaveBeenCalledWith('meta-ad-unknown');
    expect(result).toEqual({
      adMetaId: 'meta-ad-unknown',
      adTitle: 'My Ad',
      adInternalId: 'imported-ad-1',
    });
  });

  it('leaves adInternalId unset when onMissingAd returns null', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);
    const onMissingAd = vi.fn().mockResolvedValue(null);

    const result = await resolveAdReferral(
      mockDb as never,
      { metaAdId: 'meta-ad-unknown' },
      { onMissingAd }
    );

    expect(onMissingAd).toHaveBeenCalledTimes(1);
    expect(result?.adInternalId).toBeUndefined();
    expect(result?.adMetaId).toBe('meta-ad-unknown');
  });

  it('does NOT call onMissingAd when the ad is found locally', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      id: 'internal-ad-1',
    });
    const onMissingAd = vi.fn().mockResolvedValue('should-not-be-used');

    const result = await resolveAdReferral(
      mockDb as never,
      { metaAdId: 'meta-ad-123' },
      { onMissingAd }
    );

    expect(onMissingAd).not.toHaveBeenCalled();
    expect(result?.adInternalId).toBe('internal-ad-1');
  });

  it('swallows an onMissingAd throw and continues without adInternalId', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);
    const onMissingAd = vi.fn().mockRejectedValue(new Error('Meta down'));

    const result = await resolveAdReferral(
      mockDb as never,
      { metaAdId: 'meta-ad-unknown', adTitle: 'My Ad' },
      { onMissingAd }
    );

    expect(result).toEqual({ adMetaId: 'meta-ad-unknown', adTitle: 'My Ad' });
    expect(result?.adInternalId).toBeUndefined();
  });

  // --- Durable creative resolution (local DB first, FB referral fallback) ---

  it('prefers the local video poster/playback over the ephemeral FB creative', async () => {
    // 1st findFirst: the metaAdId lookup. 2nd: resolveLocalCreative.
    mockDb.query.metaAd.findFirst
      .mockResolvedValueOnce({ id: 'internal-ad-1' })
      .mockResolvedValueOnce({
        metaThumbnailUrl: 'https://meta-cdn/thumb.jpg',
        headline: 'Local Headline',
        name: 'Ad Name',
        video: {
          thumbnailUrl: 'https://our-cdn/poster.jpg',
          blobUrl: 'https://our-cdn/video.mp4',
        },
      });

    const result = await resolveAdReferral(mockDb as never, {
      metaAdId: 'meta-ad-123',
      adTitle: 'Summer Sale',
      adPhotoUrl: 'https://meta-cdn/ephemeral.jpg',
      adVideoUrl: 'https://meta-cdn/ephemeral.mp4',
    });

    expect(result).toEqual({
      adMetaId: 'meta-ad-123',
      adTitle: 'Summer Sale',
      adInternalId: 'internal-ad-1',
      adPhotoUrl: 'https://our-cdn/poster.jpg',
      adVideoUrl: 'https://our-cdn/video.mp4',
    });
  });

  it('falls back to the stored Meta thumbnail, then the FB referral image', async () => {
    mockDb.query.metaAd.findFirst
      .mockResolvedValueOnce({ id: 'internal-ad-1' })
      .mockResolvedValueOnce({
        metaThumbnailUrl: 'https://meta-cdn/thumb.jpg',
        headline: null,
        name: 'Ad Name',
        video: null,
      });

    const result = await resolveAdReferral(mockDb as never, {
      metaAdId: 'meta-ad-123',
      adTitle: 'Summer Sale',
      adPhotoUrl: 'https://meta-cdn/ephemeral.jpg',
    });

    // Stored Meta thumbnail wins over the ephemeral referral image.
    expect(result?.adPhotoUrl).toBe('https://meta-cdn/thumb.jpg');
    expect(result?.adVideoUrl).toBeUndefined();
  });

  it('keeps the ephemeral FB creative when the local ad has no creative', async () => {
    mockDb.query.metaAd.findFirst
      .mockResolvedValueOnce({ id: 'internal-ad-1' })
      .mockResolvedValueOnce({
        metaThumbnailUrl: null,
        headline: null,
        name: null,
        video: null,
      });

    const result = await resolveAdReferral(mockDb as never, {
      metaAdId: 'meta-ad-123',
      adTitle: 'Summer Sale',
      adPhotoUrl: 'https://meta-cdn/ephemeral.jpg',
      adVideoUrl: 'https://meta-cdn/ephemeral.mp4',
    });

    expect(result?.adPhotoUrl).toBe('https://meta-cdn/ephemeral.jpg');
    expect(result?.adVideoUrl).toBe('https://meta-cdn/ephemeral.mp4');
  });

  it('backfills adTitle from the local ad headline when the referral has none', async () => {
    mockDb.query.metaAd.findFirst
      .mockResolvedValueOnce({ id: 'internal-ad-1' })
      .mockResolvedValueOnce({
        metaThumbnailUrl: null,
        headline: 'Local Headline',
        name: 'Ad Name',
        video: null,
      });

    const result = await resolveAdReferral(mockDb as never, {
      metaAdId: 'meta-ad-123',
    });

    expect(result?.adTitle).toBe('Local Headline');
  });
});
