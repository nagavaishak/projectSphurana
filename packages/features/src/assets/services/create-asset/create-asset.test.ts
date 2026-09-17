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
import { createAsset } from './create-asset.service.js';

describe('createAsset', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    name: 'Test Video',
    blobUrl: 'https://storage.example.com/video.mp4',
    organizationId: 'org_123',
    uploadedById: 'user_123',
  };

  it('should create an asset with valid input', async () => {
    const mockAsset = {
      id: 'asset_123',
      ...validInput,
      type: 'video',
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([mockAsset]);

    const result = await createAsset(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe(validInput.name);
      expect(result.data.blobUrl).toBe(validInput.blobUrl);
      expect(result.data.organizationId).toBe(validInput.organizationId);
    }

    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing name', async () => {
    const invalidInput = {
      ...validInput,
      name: '',
    };

    await expectResult(
      createAsset(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for invalid blobUrl', async () => {
    const invalidInput = {
      ...validInput,
      blobUrl: 'not-a-valid-url',
    };

    await expectResult(
      createAsset(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should create asset with all optional fields', async () => {
    const fullInput = {
      ...validInput,
      sourceFileName: 'original_video.mp4',
      tags: ['marketing', 'product'],
      clientName: 'Acme Corp',
      type: 'video' as const,
      duration: 120,
      width: 1920,
      height: 1080,
      transcript: 'This is the video transcript...',
    };

    const mockAsset = {
      id: 'asset_123',
      ...fullInput,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([mockAsset]);

    const result = await createAsset(mockDb as never, fullInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sourceFileName).toBe('original_video.mp4');
      expect(result.data.tags).toEqual(['marketing', 'product']);
      expect(result.data.duration).toBe(120);
      expect(result.data.width).toBe(1920);
      expect(result.data.height).toBe(1080);
      expect(result.data.transcript).toBe('This is the video transcript...');
    }
  });

  it('should create image asset', async () => {
    const imageInput = {
      ...validInput,
      blobUrl: 'https://storage.example.com/image.jpg',
      type: 'image' as const,
      width: 800,
      height: 600,
    };

    const mockAsset = {
      id: 'asset_123',
      ...imageInput,
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([mockAsset]);

    const result = await createAsset(mockDb as never, imageInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('image');
    }
  });

  it('should use default type of video', async () => {
    const mockAsset = {
      id: 'asset_123',
      ...validInput,
      type: 'video',
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([mockAsset]);

    const result = await createAsset(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'video',
      })
    );
  });

  it('should use default empty array for tags', async () => {
    const mockAsset = {
      id: 'asset_123',
      ...validInput,
      type: 'video',
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([mockAsset]);

    const result = await createAsset(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: [],
      })
    );
  });

  it('should generate a unique ID for the asset', async () => {
    const mockAsset = {
      id: 'generated-uuid',
      ...validInput,
      type: 'video',
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([mockAsset]);

    await createAsset(mockDb as never, validInput);

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
      })
    );
  });

  it('should handle database errors gracefully', async () => {
    mockDb.returning.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(createAsset(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });
});
