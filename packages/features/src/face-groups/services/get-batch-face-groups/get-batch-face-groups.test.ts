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
import { getBatchFaceGroups } from './get-batch-face-groups.service.js';

describe('getBatchFaceGroups', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    batchId: 'batch_123',
    organizationId: 'org_123',
  };

  it('should return face groups for a batch', async () => {
    // Mock batch lookup
    mockDb.query.assetUploadBatch.findFirst.mockResolvedValueOnce({
      id: 'batch_123',
      organizationId: 'org_123',
      totalAssets: 5,
    });

    // Mock face group assets with relations
    mockDb.query.faceGroupAsset.findMany.mockResolvedValueOnce([
      {
        id: 'fga_1',
        faceGroupId: 'fg_1',
        assetId: 'asset_1',
        batchId: 'batch_123',
        role: 'before',
        faceGroup: {
          id: 'fg_1',
          organizationId: 'org_123',
          clientName: 'Jane Doe',
          serviceId: null,
        },
        asset: {
          id: 'asset_1',
          name: 'photo1.jpg',
          blobUrl: 'https://s3.example.com/photo1.jpg',
          type: 'image',
        },
      },
    ]);

    const result = await getBatchFaceGroups(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.faceGroups).toHaveLength(1);
      expect(result.data.faceGroups[0].clientName).toBe('Jane Doe');
      expect(result.data.faceGroups[0].assets).toHaveLength(1);
      expect(result.data.status).toBe('complete');
    }
  });

  it('should group assets by face group', async () => {
    mockDb.query.assetUploadBatch.findFirst.mockResolvedValueOnce({
      id: 'batch_123',
      organizationId: 'org_123',
      totalAssets: 5,
    });

    mockDb.query.faceGroupAsset.findMany.mockResolvedValueOnce([
      {
        id: 'fga_1',
        faceGroupId: 'fg_1',
        assetId: 'asset_1',
        role: 'before',
        faceGroup: {
          id: 'fg_1',
          organizationId: 'org_123',
          clientName: 'Jane',
          serviceId: null,
        },
        asset: {
          id: 'asset_1',
          name: 'a1.jpg',
          blobUrl: 'url1',
          type: 'image',
        },
      },
      {
        id: 'fga_2',
        faceGroupId: 'fg_1',
        assetId: 'asset_2',
        role: 'after',
        faceGroup: {
          id: 'fg_1',
          organizationId: 'org_123',
          clientName: 'Jane',
          serviceId: null,
        },
        asset: {
          id: 'asset_2',
          name: 'a2.jpg',
          blobUrl: 'url2',
          type: 'image',
        },
      },
    ]);

    const result = await getBatchFaceGroups(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.faceGroups).toHaveLength(1);
      expect(result.data.faceGroups[0].assets).toHaveLength(2);
    }
  });

  it('should return NOT_FOUND when batch does not exist', async () => {
    mockDb.query.assetUploadBatch.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getBatchFaceGroups(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for missing batchId', async () => {
    await expectResult(
      getBatchFaceGroups(mockDb as never, { ...validInput, batchId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      getBatchFaceGroups(mockDb as never, { ...validInput, organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should skip face group assets without a faceGroup relation', async () => {
    mockDb.query.assetUploadBatch.findFirst.mockResolvedValueOnce({
      id: 'batch_123',
      organizationId: 'org_123',
      totalAssets: 5,
    });

    mockDb.query.faceGroupAsset.findMany.mockResolvedValueOnce([
      {
        id: 'fga_1',
        faceGroupId: 'fg_1',
        assetId: 'asset_1',
        role: 'untagged',
        faceGroup: null,
        asset: {
          id: 'asset_1',
          name: 'a1.jpg',
          blobUrl: 'url1',
          type: 'image',
        },
      },
    ]);

    const result = await getBatchFaceGroups(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.faceGroups).toHaveLength(0);
    }
  });
});
