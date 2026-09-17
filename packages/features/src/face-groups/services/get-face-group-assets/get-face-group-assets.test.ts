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
import { getFaceGroupAssets } from './get-face-group-assets.service.js';

describe('getFaceGroupAssets', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    faceGroupId: 'fg_123',
    organizationId: 'org_123',
  };

  it('should return face group assets sorted by role', async () => {
    mockDb.query.faceGroup.findFirst.mockResolvedValueOnce({
      id: 'fg_123',
      clientName: 'Jane Doe',
      serviceId: 'svc_1',
      organizationId: 'org_123',
    });

    const now = new Date('2024-06-01T12:00:00Z');
    mockDb.query.faceGroupAsset.findMany.mockResolvedValueOnce([
      {
        id: 'fga_2',
        assetId: 'asset_2',
        role: 'after',
        asset: {
          id: 'asset_2',
          name: 'after.jpg',
          blobUrl: 'url2',
          type: 'image',
          duration: null,
          width: 800,
          height: 600,
          createdAt: now,
        },
      },
      {
        id: 'fga_1',
        assetId: 'asset_1',
        role: 'before',
        asset: {
          id: 'asset_1',
          name: 'before.jpg',
          blobUrl: 'url1',
          type: 'image',
          duration: null,
          width: 800,
          height: 600,
          createdAt: now,
        },
      },
      {
        id: 'fga_3',
        assetId: 'asset_3',
        role: 'untagged',
        asset: {
          id: 'asset_3',
          name: 'untagged.jpg',
          blobUrl: 'url3',
          type: 'image',
          duration: null,
          width: 800,
          height: 600,
          createdAt: now,
        },
      },
    ]);

    const result = await getFaceGroupAssets(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.faceGroup.id).toBe('fg_123');
      expect(result.data.faceGroup.clientName).toBe('Jane Doe');
      expect(result.data.assets).toHaveLength(3);
      // Sorted: before(0) → after(1) → untagged(2)
      expect(result.data.assets[0].role).toBe('before');
      expect(result.data.assets[1].role).toBe('after');
      expect(result.data.assets[2].role).toBe('untagged');
    }
  });

  it('should return empty assets when face group has no assets', async () => {
    mockDb.query.faceGroup.findFirst.mockResolvedValueOnce({
      id: 'fg_123',
      clientName: null,
      serviceId: null,
      organizationId: 'org_123',
    });

    mockDb.query.faceGroupAsset.findMany.mockResolvedValueOnce([]);

    const result = await getFaceGroupAssets(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assets).toHaveLength(0);
    }
  });

  it('should filter out assets without an asset relation', async () => {
    mockDb.query.faceGroup.findFirst.mockResolvedValueOnce({
      id: 'fg_123',
      clientName: null,
      serviceId: null,
      organizationId: 'org_123',
    });

    mockDb.query.faceGroupAsset.findMany.mockResolvedValueOnce([
      {
        id: 'fga_1',
        assetId: 'asset_1',
        role: 'before',
        asset: null,
      },
      {
        id: 'fga_2',
        assetId: 'asset_2',
        role: 'after',
        asset: {
          id: 'asset_2',
          name: 'after.jpg',
          blobUrl: 'url2',
          type: 'image',
          duration: null,
          width: 800,
          height: 600,
          createdAt: new Date('2024-06-01T12:00:00Z'),
        },
      },
    ]);

    const result = await getFaceGroupAssets(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assets).toHaveLength(1);
      expect(result.data.assets[0].assetId).toBe('asset_2');
    }
  });

  it('should return NOT_FOUND when face group does not exist', async () => {
    mockDb.query.faceGroup.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getFaceGroupAssets(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for missing faceGroupId', async () => {
    await expectResult(
      getFaceGroupAssets(mockDb as never, { ...validInput, faceGroupId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      getFaceGroupAssets(mockDb as never, { ...validInput, organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should convert asset createdAt to ISO string', async () => {
    const createdAt = new Date('2024-03-15T10:30:00Z');

    mockDb.query.faceGroup.findFirst.mockResolvedValueOnce({
      id: 'fg_123',
      clientName: null,
      serviceId: null,
      organizationId: 'org_123',
    });

    mockDb.query.faceGroupAsset.findMany.mockResolvedValueOnce([
      {
        id: 'fga_1',
        assetId: 'asset_1',
        role: 'before',
        asset: {
          id: 'asset_1',
          name: 'photo.jpg',
          blobUrl: 'url1',
          type: 'image',
          duration: null,
          width: 1920,
          height: 1080,
          createdAt,
        },
      },
    ]);

    const result = await getFaceGroupAssets(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assets[0].asset.createdAt).toBe(
        '2024-03-15T10:30:00.000Z'
      );
    }
  });
});
