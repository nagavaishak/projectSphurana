import { buildCreateSocialPostPayload } from '@/features/social-posts/api';
import { describe, expect, it } from 'vitest';
import type { GalleryMediaItem } from './media-preview-dialog';
import { toPostableMedia } from './postable-media';

/**
 * A carousel posted from the gallery published as its FIRST SLIDE ONLY, on a
 * paying customer's live Facebook and Instagram, with both platforms reporting
 * success. Nothing errored, so nothing was logged.
 *
 * Two independent steps each destroyed the carousel: the gallery flattened the
 * graphic to `outputs[0].url`, and the payload builder had no field to carry
 * the rest. These tests pin the whole path — tile → intent → wire body — rather
 * than either half, because either half alone silently reintroduces the bug.
 */

function graphicTile(
  outputs: { url: string; slideOrder?: number; slideId?: string }[]
): GalleryMediaItem {
  return {
    kind: 'graphic',
    data: {
      id: 'graphic-1',
      title: 'Five myths',
      outputs: outputs.map((o) => ({ ...o, status: 'success' })),
    },
  } as unknown as GalleryMediaItem;
}

const PAGE_IDS = ['page-1'];

// The builder now resolves the schedule in the BUSINESS timezone (ENG-738).
// These cases assert media identity, not scheduling, so any fixed zone will do
// — it just has to be explicit rather than the machine's.
const ORG_TIME_ZONE = 'Europe/Dublin';

function bodyFor(item: GalleryMediaItem) {
  const media = toPostableMedia(item);
  if (!media) throw new Error('expected the tile to be postable');
  return buildCreateSocialPostPayload(
    {
      title: media.name,
      mediaType: media.type,
      mediaUrl: media.blobUrl,
      mediaUrls: media.mediaUrls,
      graphicId: media.graphicId,
      videoId: media.videoId,
      pageIds: PAGE_IDS,
      schedule: { mode: 'now' },
    },
    ORG_TIME_ZONE
  );
}

describe('toPostableMedia', () => {
  it('carries every slide of a carousel, in slideOrder', () => {
    const media = toPostableMedia(
      graphicTile([
        { url: 'https://cdn.test/2.png', slideOrder: 2, slideId: 'c' },
        { url: 'https://cdn.test/0.png', slideOrder: 0, slideId: 'a' },
        { url: 'https://cdn.test/1.png', slideOrder: 1, slideId: 'b' },
      ])
    );

    expect(media?.mediaUrls).toEqual([
      'https://cdn.test/0.png',
      'https://cdn.test/1.png',
      'https://cdn.test/2.png',
    ]);
    // mediaUrl must be slide 1, not whichever output happened to be first.
    expect(media?.blobUrl).toBe('https://cdn.test/0.png');
    expect(media?.graphicId).toBe('graphic-1');
  });

  it('does NOT treat one image exported at several aspect ratios as a carousel', () => {
    // No slide metadata — this is a single graphic with 4:5 / 1:1 / 9:16 cuts.
    // Publishing it as a 3-image carousel would post the same picture 3 times.
    const media = toPostableMedia(
      graphicTile([
        { url: 'https://cdn.test/a.png' },
        { url: 'https://cdn.test/b.png' },
        { url: 'https://cdn.test/c.png' },
      ])
    );

    expect(media?.mediaUrls).toBeUndefined();
    expect(media?.blobUrl).toBe('https://cdn.test/a.png');
  });

  it('returns null when a graphic has no usable render yet', () => {
    expect(toPostableMedia(graphicTile([]))).toBeNull();
  });
});

describe('buildCreateSocialPostPayload — media identity', () => {
  it('sends every slide and the graphic reference for a carousel', () => {
    const body = bodyFor(
      graphicTile([
        { url: 'https://cdn.test/0.png', slideOrder: 0, slideId: 'a' },
        { url: 'https://cdn.test/1.png', slideOrder: 1, slideId: 'b' },
      ])
    );

    expect(body.mediaUrls).toEqual([
      'https://cdn.test/0.png',
      'https://cdn.test/1.png',
    ]);
    expect(body.graphicId).toBe('graphic-1');
  });

  it('OMITS mediaUrls for single media rather than sending an empty array', () => {
    // Blank-vs-absent on an optional is its own class of bug here: the service
    // reads `length > 1`, but an `[]` on the wire is the shape that has broken
    // requests in this codebase before. Absent is the contract.
    const body = bodyFor(graphicTile([{ url: 'https://cdn.test/only.png' }]));

    expect(body.mediaUrls).toBeUndefined();
    expect('mediaUrls' in body).toBe(false);
    expect(body.graphicId).toBe('graphic-1');
  });

  it('carries videoId for a generated video', () => {
    const tile = {
      kind: 'video',
      data: {
        id: 'video-1',
        title: 'Clip',
        blobUrl: 'https://cdn.test/v.mp4',
        thumbnailUrl: 'https://cdn.test/v.jpg',
      },
    } as unknown as GalleryMediaItem;

    const body = bodyFor(tile);

    expect(body.videoId).toBe('video-1');
    expect(body.mediaType).toBe('video');
    expect(body.mediaUrls).toBeUndefined();
  });

  it('leaves an uploaded asset with no source reference', () => {
    const tile = {
      kind: 'asset',
      data: {
        id: 'asset-1',
        name: 'Upload',
        type: 'image',
        blobUrl: 'https://cdn.test/u.png',
        thumbnailUrl: null,
      },
    } as unknown as GalleryMediaItem;

    const body = bodyFor(tile);

    expect(body.graphicId).toBeUndefined();
    expect(body.videoId).toBeUndefined();
    expect(body.mediaUrls).toBeUndefined();
    expect(body.mediaUrl).toBe('https://cdn.test/u.png');
  });
});
