import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { listAssetsByService } from './list-assets-by-service.service.js';

describe('listAssetsByService', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    serviceId: 'service_123',
    organizationId: 'org_123',
  };

  it('should return assets linked to service', async () => {
    const mockAssets = [
      {
        asset: {
          id: 'asset_1',
          name: 'Video 1',
          blobUrl: 'https://storage.example.com/v1.mp4',
          type: 'video',
          organizationId: 'org_123',
          tags: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        confidence: 0.95,
      },
      {
        asset: {
          id: 'asset_2',
          name: 'Video 2',
          blobUrl: 'https://storage.example.com/v2.mp4',
          type: 'video',
          organizationId: 'org_123',
          tags: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        confidence: 0.8,
      },
    ];

    mockDb.orderBy.mockResolvedValueOnce(mockAssets);

    const result = await listAssetsByService(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toBe('asset_1');
      expect(result.data[1].id).toBe('asset_2');
    }

    expect(mockDb.select).toHaveBeenCalled();
    expect(mockDb.from).toHaveBeenCalled();
    expect(mockDb.innerJoin).toHaveBeenCalled();
  });

  it('should return empty array when no assets found', async () => {
    mockDb.orderBy.mockResolvedValueOnce([]);

    const result = await listAssetsByService(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
      expect(result.data).toEqual([]);
    }
  });

  it('accepts image assets for graphic source selection', async () => {
    mockDb.orderBy.mockResolvedValueOnce([
      {
        asset: {
          id: 'image_1',
          name: 'Treatment photo',
          blobUrl: 'https://storage.example.com/photo.jpg',
          type: 'image',
          organizationId: 'org_123',
          tags: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        confidence: 1,
      },
    ]);

    const result = await listAssetsByService(mockDb as never, {
      ...validInput,
      type: 'image',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data[0]?.type).toBe('image');
  });

  it('should return VALIDATION_ERROR for empty serviceId', async () => {
    const invalidInput = {
      serviceId: '',
      organizationId: 'org_123',
    };

    await expectResult(
      listAssetsByService(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = {
      serviceId: 'service_123',
      organizationId: '',
    };

    await expectResult(
      listAssetsByService(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.select).not.toHaveBeenCalled();
  });
});
