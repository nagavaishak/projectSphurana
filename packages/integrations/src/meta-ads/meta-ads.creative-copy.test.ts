import { describe, expect, it } from 'vitest';
import { readCreativeCopy } from './meta-ads.service.js';

/**
 * Where an ad's COPY actually lives in a Graph response.
 *
 * Meta exposes `creative.title` / `creative.body` at the top level, but only
 * fills them for creatives that were CREATED with them. Every creative Borradh
 * builds goes through `object_story_spec` — `link_data` for image ads,
 * `video_data` for video — and for those the top-level fields come back empty
 * while the real copy sits one level down.
 *
 * Reading only the top level meant "this ad has no copy" for every ad we have
 * ever published, and `importMetaAds` wrote those blanks over the owner's
 * words. Reproduced on a preview: one `POST /meta-ads/import` blanked
 * headline, primaryText, description and destinationUrl on a live ad.
 */
describe('readCreativeCopy', () => {
  it('reads an image ad’s copy out of link_data', () => {
    expect(
      readCreativeCopy({
        object_story_spec: {
          link_data: {
            name: 'Balayage, booking now',
            message: 'Autumn colour with our senior stylists.',
            description: 'Book online',
            link: 'https://bloom.example/book',
          },
        },
      })
    ).toEqual({
      title: 'Balayage, booking now',
      body: 'Autumn colour with our senior stylists.',
      linkUrl: 'https://bloom.example/book',
      linkDescription: 'Book online',
    });
  });

  it('reads a video ad’s copy out of video_data', () => {
    expect(
      readCreativeCopy({
        object_story_spec: {
          video_data: {
            title: 'Frizz-free for 12 weeks',
            message: 'Keratin smoothing, now booking.',
            link_description: 'Book online',
          },
        },
      })
    ).toMatchObject({
      title: 'Frizz-free for 12 weeks',
      body: 'Keratin smoothing, now booking.',
      linkDescription: 'Book online',
    });
  });

  it('prefers the top-level fields when Meta did fill them', () => {
    expect(
      readCreativeCopy({
        title: 'Top level',
        body: 'Top body',
        link_url: 'https://top.example',
        object_story_spec: {
          link_data: {
            name: 'Spec',
            message: 'Spec body',
            link: 'https://spec.example',
          },
        },
      })
    ).toMatchObject({
      title: 'Top level',
      body: 'Top body',
      linkUrl: 'https://top.example',
    });
  });

  it('reports undefined — never a wrong value — when there is genuinely no copy', () => {
    // The caller must be able to tell "Meta said nothing" from "Meta said
    // empty", because one of those is allowed to overwrite and the other is not.
    expect(readCreativeCopy({})).toEqual({
      title: undefined,
      body: undefined,
      linkUrl: undefined,
      linkDescription: undefined,
    });
  });
});
