import { describe, expect, it, vi } from '@borradh-workspace/testing';
import { loadAdPreviewMediaByMediaId } from './load-ad-preview-media.js';

/**
 * `metaAd.videoId` holds EITHER a `video.id` or an `asset.id`. The read path
 * used to join only `video`, so 42 of 130 production ads across 20
 * organisations resolved to nothing and previewed blank — 12 of them with no
 * Meta thumbnail to fall back on, so the panel was simply empty.
 */
const makeDb = (videos: unknown[], assets: unknown[]) => ({
  query: {
    video: { findMany: vi.fn().mockResolvedValue(videos) },
    asset: { findMany: vi.fn().mockResolvedValue(assets) },
  },
});

describe('loadAdPreviewMediaByMediaId', () => {
  it('resolves a video id from the video table', async () => {
    const db = makeDb(
      [
        {
          id: 'v1',
          title: 'Promo',
          blobUrl: 'https://cdn/v1.mp4',
          thumbnailUrl: 'https://cdn/v1.jpg',
          durationMs: 20_000,
        },
      ],
      []
    );

    const map = await loadAdPreviewMediaByMediaId(db as never, ['v1']);

    expect(map.get('v1')).toEqual({
      title: 'Promo',
      videoUrl: 'https://cdn/v1.mp4',
      thumbnailUrl: 'https://cdn/v1.jpg',
      durationMs: 20_000,
      width: null,
      height: null,
    });
    // Nothing left over, so the asset table is never queried.
    expect(db.query.asset.findMany).not.toHaveBeenCalled();
  });

  it('falls back to the asset table — the blank-preview case', async () => {
    const db = makeDb(
      [],
      [
        {
          id: 'a1',
          name: 'Laser package',
          type: 'video',
          blobUrl: 'https://cdn/a1.mov',
          thumbnailUrl: 'https://cdn/a1.jpg',
          transcodedBlobUrl: null,
          transcodeStatus: 'skipped',
          duration: 12.5,
          width: 1080,
          height: 1920,
          deletedAt: null,
        },
      ]
    );

    const map = await loadAdPreviewMediaByMediaId(db as never, ['a1']);

    expect(map.get('a1')).toEqual({
      title: 'Laser package',
      videoUrl: 'https://cdn/a1.mov',
      thumbnailUrl: 'https://cdn/a1.jpg',
      durationMs: 12_500,
      width: 1080,
      height: 1920,
    });
  });

  it('treats an image asset as the image itself, not as a video', async () => {
    const db = makeDb(
      [],
      [
        {
          id: 'a2',
          name: 'Offer graphic',
          type: 'image',
          blobUrl: 'https://cdn/a2.png',
          thumbnailUrl: null,
          transcodedBlobUrl: null,
          transcodeStatus: 'skipped',
          duration: null,
          width: 1080,
          height: 1350,
          deletedAt: null,
        },
      ]
    );

    const media = (await loadAdPreviewMediaByMediaId(db as never, ['a2'])).get(
      'a2'
    );

    expect(media?.videoUrl).toBeNull();
    expect(media?.thumbnailUrl).toBe('https://cdn/a2.png');
    expect(media?.durationMs).toBeNull();
  });

  it('prefers the transcoded copy for playback when it is ready', async () => {
    const db = makeDb(
      [],
      [
        {
          id: 'a3',
          name: 'Clip',
          type: 'video',
          blobUrl: 'https://cdn/a3-original.mov',
          thumbnailUrl: null,
          transcodedBlobUrl: 'https://cdn/a3.mp4',
          transcodeStatus: 'ready',
          duration: 5,
          width: null,
          height: null,
          deletedAt: null,
        },
      ]
    );

    expect(
      (await loadAdPreviewMediaByMediaId(db as never, ['a3'])).get('a3')
        ?.videoUrl
    ).toBe('https://cdn/a3.mp4');
  });

  it('ignores a deleted asset rather than serving its URL', async () => {
    const db = makeDb(
      [],
      [
        {
          id: 'a4',
          name: 'Gone',
          type: 'image',
          blobUrl: 'https://cdn/a4.png',
          thumbnailUrl: null,
          transcodedBlobUrl: null,
          transcodeStatus: 'skipped',
          duration: null,
          width: null,
          height: null,
          deletedAt: new Date(),
        },
      ]
    );

    expect((await loadAdPreviewMediaByMediaId(db as never, ['a4'])).size).toBe(
      0
    );
  });

  it('queries nothing when there are no media ids', async () => {
    const db = makeDb([], []);
    const map = await loadAdPreviewMediaByMediaId(db as never, [
      null,
      undefined,
    ]);
    expect(map.size).toBe(0);
    expect(db.query.video.findMany).not.toHaveBeenCalled();
    expect(db.query.asset.findMany).not.toHaveBeenCalled();
  });
});
