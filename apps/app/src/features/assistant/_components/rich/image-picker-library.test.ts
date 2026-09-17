import type { Asset } from '@borradh-workspace/api-client/types';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUBJECT_IMAGE_COUNT,
  buildImagePickerLibrary,
  describeImageryOrder,
  filterImagePickerLibrary,
  getDefaultServiceImageIds,
} from './image-picker-library';

const asset = (overrides: Partial<Asset> & Pick<Asset, 'id' | 'name'>) =>
  ({
    type: 'image',
    source: 'raw',
    tags: [],
    ...overrides,
  }) as Asset;

describe('image picker library', () => {
  it('keeps only uploaded raw images and puts service matches first', () => {
    const general = [
      asset({ id: 'general', name: 'General' }),
      asset({ id: 'match', name: 'Signed match' }),
      asset({ id: 'edited', name: 'Edited', source: 'edited' }),
      asset({ id: 'video', name: 'Video', type: 'video' }),
    ];
    const service = [asset({ id: 'match', name: 'Service match' })];

    const result = buildImagePickerLibrary(general, service);
    expect(result.ordered.map((item) => item.id)).toEqual(['match', 'general']);
    expect(result.ordered[0]?.name).toBe('Signed match');
    expect(result.serviceLinked).toEqual(new Set(['match']));
  });

  it('filters by tag and search', () => {
    const images = [
      asset({ id: 'one', name: 'Treatment room', tags: ['interior'] }),
      asset({ id: 'two', name: 'Happy client', tags: ['testimonial'] }),
    ];
    expect(filterImagePickerLibrary(images, 'interior', '')).toHaveLength(1);
    expect(filterImagePickerLibrary(images, 'all', 'client')).toEqual([
      images[1],
    ]);
  });

  it('preselects uploaded service images in order and caps the selection', () => {
    const service = [
      asset({ id: 'first', name: 'First' }),
      asset({ id: 'edited', name: 'Edited', source: 'edited' }),
      asset({ id: 'video', name: 'Video', type: 'video' }),
      asset({ id: 'second', name: 'Second' }),
      asset({ id: 'first', name: 'Duplicate first' }),
    ];

    expect(getDefaultServiceImageIds(service, 2)).toEqual(['first', 'second']);
  });

  it('preselects exactly one image by default', () => {
    // A single graphic attaches ONE subject photo to the model; the rest of a
    // selection is discarded downstream. Preselecting more than one promises
    // the owner images that are never sent, so the default is pinned at one.
    const service = [
      asset({ id: 'first', name: 'First' }),
      asset({ id: 'second', name: 'Second' }),
      asset({ id: 'third', name: 'Third' }),
    ];

    expect(getDefaultServiceImageIds(service)).toEqual(['first']);
    expect(DEFAULT_SUBJECT_IMAGE_COUNT).toBe(1);
  });

  describe('describeImageryOrder', () => {
    it('names the strictest setting as producing no photo at all', () => {
      // Both permissions off is the setting owners ask for by name ("only use
      // real pictures of me") and the one the switch positions hide: two
      // things turned off look like nothing was configured.
      expect(
        describeImageryOrder({
          hasChosenImages: false,
          allowStockImages: false,
          allowAiImages: false,
        })
      ).toBe(
        'your uploaded photos — and if there are none, a text-led design with no photo.'
      );
    });

    it('lists each permitted tier in fallback order', () => {
      expect(
        describeImageryOrder({
          hasChosenImages: true,
          allowStockImages: true,
          allowAiImages: true,
        })
      ).toBe('your chosen photo → curated stock → AI imagery.');

      expect(
        describeImageryOrder({
          hasChosenImages: false,
          allowStockImages: false,
          allowAiImages: true,
        })
      ).toBe('your uploaded photos → AI imagery.');
    });

    it("always puts the owner's own imagery first", () => {
      // Every policy in the renderer tries the org's own assets before any
      // backstop; a description that implied otherwise would be a lie about
      // what the flags do.
      for (const allowStockImages of [true, false]) {
        for (const allowAiImages of [true, false]) {
          expect(
            describeImageryOrder({
              hasChosenImages: false,
              allowStockImages,
              allowAiImages,
            })
          ).toMatch(/^your uploaded photos/);
        }
      }
    });
  });
});
