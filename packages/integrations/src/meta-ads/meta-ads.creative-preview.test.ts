import { describe, expect, it } from 'vitest';
import { pickCreativePreviewUrl } from './meta-ads.service.js';

/**
 * These assertions encode what production creatives actually return, measured
 * against live ads: `thumbnail_url` is ALWAYS a 64x64 centre-cropped square
 * (`stp=c0.5000x0.5000f_..._p64x64_...`), and Meta ignores the `.width()` /
 * `.height()` field modifiers on it. The full-size creative only ever comes
 * from `image_url` (1260x2240 on an image creative) or
 * `object_story_spec.video_data.image_url` (1080x1920 on a video creative).
 *
 * If someone reorders this preference, imported ads go back to previewing as a
 * tiny cropped stamp.
 */
describe('pickCreativePreviewUrl', () => {
  const THUMB = 'https://scontent.fbcdn.net/thumb.jpg?stp=p64x64';

  it('prefers image_url over the 64x64 thumbnail (image creative)', () => {
    expect(
      pickCreativePreviewUrl({
        thumbnail_url: THUMB,
        image_url: 'https://example.com/full.jpg',
      })
    ).toBe('https://example.com/full.jpg');
  });

  it('prefers the video cover frame over the 64x64 thumbnail (video creative)', () => {
    expect(
      pickCreativePreviewUrl({
        thumbnail_url: THUMB,
        object_story_spec: {
          video_data: { image_url: 'https://example.com/cover.jpg' },
        },
      })
    ).toBe('https://example.com/cover.jpg');
  });

  it('prefers the link picture over the 64x64 thumbnail (link creative)', () => {
    expect(
      pickCreativePreviewUrl({
        thumbnail_url: THUMB,
        object_story_spec: {
          link_data: { picture: 'https://example.com/p.jpg' },
        },
      })
    ).toBe('https://example.com/p.jpg');
  });

  it('falls back to the thumbnail when nothing better exists', () => {
    expect(pickCreativePreviewUrl({ thumbnail_url: THUMB })).toBe(THUMB);
  });

  it('returns undefined for a creative with no image at all', () => {
    expect(pickCreativePreviewUrl({})).toBeUndefined();
    expect(pickCreativePreviewUrl(undefined)).toBeUndefined();
  });

  it('ignores an empty-string image_url rather than preferring it', () => {
    expect(
      pickCreativePreviewUrl({ thumbnail_url: THUMB, image_url: '' })
    ).toBe(THUMB);
  });
});
