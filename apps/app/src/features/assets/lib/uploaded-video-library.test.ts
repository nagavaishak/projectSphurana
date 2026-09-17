import type { Asset } from '@borradh-workspace/api-client/types';
import { describe, expect, it } from 'vitest';
import {
  buildUploadedVideoLibrary,
  filterUploadedVideoLibrary,
} from './uploaded-video-library';

const asset = (overrides: Partial<Asset>): Asset =>
  ({
    id: 'asset-1',
    name: 'Procedure clip',
    type: 'video',
    source: 'raw',
    tags: ['procedure'],
    services: [],
    ...overrides,
  }) as Asset;

describe('uploaded video library', () => {
  it('keeps raw uploaded videos only and puts service matches first', () => {
    const general = [
      asset({ id: 'other' }),
      asset({ id: 'match', thumbnailUrl: 'signed-thumb' }),
      asset({ id: 'stock', source: 'stock' }),
      asset({ id: 'image', type: 'image' }),
    ];
    const service = [asset({ id: 'match', thumbnailUrl: null })];

    const result = buildUploadedVideoLibrary(general, service);

    expect(result.ordered.map((item) => item.id)).toEqual(['match', 'other']);
    expect(result.ordered[0]?.thumbnailUrl).toBe('signed-thumb');
    expect(result.serviceLinked).toEqual(new Set(['match']));
  });

  it('composes category, search, and exact service filtering', () => {
    const promoted = new Set(['promoted']);
    const items = [
      asset({ id: 'promoted', name: 'Laser close-up' }),
      asset({
        id: 'other-service',
        name: 'Laser room',
        services: [{ id: 'service-2', name: 'Service 2' }],
      }),
      asset({ id: 'wrong-tag', tags: ['environment'] }),
    ];

    expect(
      filterUploadedVideoLibrary(items, 'procedure', 'laser', {
        serviceId: 'service-1',
        promotedServiceId: 'service-1',
        promotedServiceAssetIds: promoted,
      }).map((item) => item.id)
    ).toEqual(['promoted']);
    expect(
      filterUploadedVideoLibrary(items, 'procedure', '', {
        serviceId: 'service-2',
      }).map((item) => item.id)
    ).toEqual(['other-service']);
  });
});
