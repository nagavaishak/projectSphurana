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
import {
  addAssetTags,
  removeAssetTags,
  updateAssetTags,
} from './update-asset-tags.service.js';

describe('updateAssetTags', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    assetId: 'asset_123',
    organizationId: 'org_123',
    tags: ['marketing', 'product'],
  };

  const mockAsset = {
    id: 'asset_123',
    name: 'Test Video',
    blobUrl: 'https://storage.example.com/video.mp4',
    organizationId: 'org_123',
    type: 'video',
    tags: ['old-tag'],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('should replace tags successfully', async () => {
    const updatedAsset = {
      ...mockAsset,
      tags: ['marketing', 'product'],
    };

    mockDb.query.asset.findFirst.mockResolvedValueOnce(mockAsset);
    mockDb.returning.mockResolvedValueOnce([updatedAsset]);

    const result = await updateAssetTags(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual(['marketing', 'product']);
    }

    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should return NOT_FOUND when asset not found', async () => {
    mockDb.query.asset.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      updateAssetTags(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty assetId', async () => {
    const invalidInput = {
      assetId: '',
      organizationId: 'org_123',
      tags: ['marketing'],
    };

    await expectResult(
      updateAssetTags(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.asset.findFirst).not.toHaveBeenCalled();
  });

  it('should normalize and dedupe tags', async () => {
    const inputWithDupes = {
      assetId: 'asset_123',
      organizationId: 'org_123',
      tags: ['Marketing', ' MARKETING ', 'product', 'Product'],
    };

    const updatedAsset = {
      ...mockAsset,
      tags: ['marketing', 'product'],
    };

    mockDb.query.asset.findFirst.mockResolvedValueOnce(mockAsset);
    mockDb.returning.mockResolvedValueOnce([updatedAsset]);

    const result = await updateAssetTags(mockDb as never, inputWithDupes);

    expect(result.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith({
      tags: ['marketing', 'product'],
    });
  });
});

describe('addAssetTags', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const mockAsset = {
    id: 'asset_123',
    name: 'Test Video',
    blobUrl: 'https://storage.example.com/video.mp4',
    organizationId: 'org_123',
    type: 'video',
    tags: ['existing-tag'],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('should add tags to existing tags', async () => {
    const updatedAsset = {
      ...mockAsset,
      tags: ['existing-tag', 'new-tag-1', 'new-tag-2'],
    };

    mockDb.query.asset.findFirst.mockResolvedValueOnce(mockAsset);
    mockDb.returning.mockResolvedValueOnce([updatedAsset]);

    const result = await addAssetTags(mockDb as never, {
      assetId: 'asset_123',
      organizationId: 'org_123',
      tags: ['new-tag-1', 'new-tag-2'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toContain('existing-tag');
      expect(result.data.tags).toContain('new-tag-1');
      expect(result.data.tags).toContain('new-tag-2');
    }

    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should return NOT_FOUND when asset not found', async () => {
    mockDb.query.asset.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      addAssetTags(mockDb as never, {
        assetId: 'asset_123',
        organizationId: 'org_123',
        tags: ['new-tag'],
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for exceeding 20 tags total', async () => {
    const assetWithManyTags = {
      ...mockAsset,
      tags: Array.from({ length: 18 }, (_, i) => `tag-${i}`),
    };

    mockDb.query.asset.findFirst.mockResolvedValueOnce(assetWithManyTags);

    await expectResult(
      addAssetTags(mockDb as never, {
        assetId: 'asset_123',
        organizationId: 'org_123',
        tags: ['extra-1', 'extra-2', 'extra-3'],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty tags array', async () => {
    await expectResult(
      addAssetTags(mockDb as never, {
        assetId: 'asset_123',
        organizationId: 'org_123',
        tags: [],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.asset.findFirst).not.toHaveBeenCalled();
  });
});

describe('removeAssetTags', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const mockAsset = {
    id: 'asset_123',
    name: 'Test Video',
    blobUrl: 'https://storage.example.com/video.mp4',
    organizationId: 'org_123',
    type: 'video',
    tags: ['marketing', 'product', 'demo'],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('should remove specified tags', async () => {
    const updatedAsset = {
      ...mockAsset,
      tags: ['demo'],
    };

    mockDb.query.asset.findFirst.mockResolvedValueOnce(mockAsset);
    mockDb.returning.mockResolvedValueOnce([updatedAsset]);

    const result = await removeAssetTags(mockDb as never, {
      assetId: 'asset_123',
      organizationId: 'org_123',
      tags: ['marketing', 'product'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual(['demo']);
    }

    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({
      tags: ['demo'],
    });
  });

  it('should return NOT_FOUND when asset not found', async () => {
    mockDb.query.asset.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      removeAssetTags(mockDb as never, {
        assetId: 'asset_123',
        organizationId: 'org_123',
        tags: ['marketing'],
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty tags array', async () => {
    await expectResult(
      removeAssetTags(mockDb as never, {
        assetId: 'asset_123',
        organizationId: 'org_123',
        tags: [],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.asset.findFirst).not.toHaveBeenCalled();
  });
});
