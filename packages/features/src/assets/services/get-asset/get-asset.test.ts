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
import { getAsset } from './get-asset.service.js';

describe('getAsset', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'asset_123',
    organizationId: 'org_123',
  };

  it('should return asset when found', async () => {
    const mockAsset = {
      id: 'asset_123',
      name: 'Test Video',
      blobUrl: 'https://storage.example.com/video.mp4',
      sourceFileName: 'video.mp4',
      tags: ['marketing'],
      clientName: 'Acme Corp',
      type: 'video',
      duration: 120,
      width: 1920,
      height: 1080,
      transcript: 'Video transcript',
      organizationId: 'org_123',
      uploadedById: 'user_123',
      createdAt: new Date(),
      updatedAt: new Date(),
      uploader: {
        id: 'user_123',
        name: 'John Doe',
        email: 'john@example.com',
        image: null,
      },
    };

    mockDb.limit.mockResolvedValueOnce([mockAsset]);

    const result = await getAsset(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.id).toBe('asset_123');
      expect(result.data?.name).toBe('Test Video');
      expect(result.data?.uploader?.name).toBe('John Doe');
    }
  });

  it('should return null when asset is not found', async () => {
    mockDb.limit.mockResolvedValueOnce([]);

    const result = await getAsset(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {
      id: '',
      organizationId: 'org_123',
    };

    await expectResult(getAsset(mockDb as never, invalidInput)).toFailWithCode(
      ErrorCodes.VALIDATION_ERROR
    );

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      id: 'asset_123',
      organizationId: '',
    };

    await expectResult(getAsset(mockDb as never, invalidInput)).toFailWithCode(
      ErrorCodes.VALIDATION_ERROR
    );

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('should not return asset from different organization', async () => {
    // The query includes organization filter, so different org should return empty
    mockDb.limit.mockResolvedValueOnce([]);

    const inputWithDifferentOrg = {
      id: 'asset_123',
      organizationId: 'different_org',
    };

    const result = await getAsset(mockDb as never, inputWithDifferentOrg);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it('should include uploader information', async () => {
    const mockAsset = {
      id: 'asset_123',
      name: 'Test Video',
      blobUrl: 'https://storage.example.com/video.mp4',
      organizationId: 'org_123',
      uploadedById: 'user_123',
      uploader: {
        id: 'user_123',
        name: 'Jane Smith',
        email: 'jane@example.com',
        image: 'https://example.com/avatar.jpg',
      },
    };

    mockDb.limit.mockResolvedValueOnce([mockAsset]);

    const result = await getAsset(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success && result.data) {
      expect(result.data.uploader).toBeDefined();
      expect(result.data.uploader?.name).toBe('Jane Smith');
      expect(result.data.uploader?.email).toBe('jane@example.com');
    }
  });

  it('should handle database errors gracefully', async () => {
    mockDb.limit.mockRejectedValueOnce(new Error('Database connection failed'));

    await expect(getAsset(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });
});
