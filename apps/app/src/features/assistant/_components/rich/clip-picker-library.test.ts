import type { Asset } from '@borradh-workspace/api-client/types';
import { describe, expect, it } from 'vitest';

import {
  buildClipPickerLibrary,
  filterClipPickerLibrary,
} from './clip-picker-library';

function asset(id: string, options: Partial<Asset> = {}): Asset {
  return {
    id,
    name: `Clip ${id}`,
    type: 'video',
    source: 'raw',
    tags: [],
    ...options,
  } as Asset;
}

describe('buildClipPickerLibrary', () => {
  it('puts service-linked uploads first without duplicating them', () => {
    const all = [asset('general'), asset('service', { thumbnailUrl: 'thumb' })];
    const service = [asset('service')];

    const result = buildClipPickerLibrary(all, service);

    expect(result.ordered.map((clip) => clip.id)).toEqual([
      'service',
      'general',
    ]);
    expect(result.ordered[0]?.thumbnailUrl).toBe('thumb');
    expect(result.serviceLinked.has('service')).toBe(true);
  });

  it('excludes image assets from the b-roll gallery', () => {
    const result = buildClipPickerLibrary(
      [asset('uploaded'), asset('image', { type: 'image' })],
      [asset('service-image', { type: 'image' })]
    );

    expect(result.ordered.map((clip) => clip.id)).toEqual(['uploaded']);
    expect(result.serviceLinked.size).toBe(0);
  });

  it('excludes stock footage even when it is linked to the service', () => {
    const result = buildClipPickerLibrary(
      [asset('uploaded'), asset('stock', { source: 'stock' })],
      [asset('stock', { source: 'stock' })]
    );

    expect(result.ordered.map((clip) => clip.id)).toEqual(['uploaded']);
    expect(result.serviceLinked.size).toBe(0);
  });
});

describe('filterClipPickerLibrary', () => {
  const clips = [
    asset('one', { name: 'Laser treatment', tags: ['procedure'] }),
    asset('two', { name: 'Clinic tour', tags: ['environment'] }),
  ];

  it('filters by gallery tag', () => {
    expect(
      filterClipPickerLibrary(clips, 'procedure', '').map((clip) => clip.id)
    ).toEqual(['one']);
  });

  it('searches clip names and tags case-insensitively', () => {
    expect(
      filterClipPickerLibrary(clips, 'all', 'CLINIC').map((clip) => clip.id)
    ).toEqual(['two']);
    expect(
      filterClipPickerLibrary(clips, 'all', 'PROCEDURE').map((clip) => clip.id)
    ).toEqual(['one']);
  });
});
