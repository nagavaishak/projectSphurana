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
import { createUploadBatch } from './create-upload-batch.service.js';

describe('createUploadBatch', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    totalAssets: 5,
    organizationId: 'org_123',
    createdById: 'user_123',
  };

  it('should create batch with valid input', async () => {
    const mockBatch = {
      id: 'batch_123',
      totalAssets: 5,
      completedAssets: 0,
      failedAssets: 0,
      status: 'processing',
      organizationId: 'org_123',
      createdById: 'user_123',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([mockBatch]);

    const result = await createUploadBatch(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalAssets).toBe(5);
      expect(result.data.status).toBe('processing');
      expect(result.data.organizationId).toBe('org_123');
      expect(result.data.createdById).toBe('user_123');
    }

    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for totalAssets < 1', async () => {
    const invalidInput = {
      ...validInput,
      totalAssets: 0,
    };

    await expectResult(
      createUploadBatch(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      ...validInput,
      organizationId: '',
    };

    await expectResult(
      createUploadBatch(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing createdById', async () => {
    const invalidInput = {
      ...validInput,
      createdById: '',
    };

    await expectResult(
      createUploadBatch(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should generate a unique ID for the batch', async () => {
    const mockBatch = {
      id: 'generated-uuid',
      ...validInput,
      completedAssets: 0,
      failedAssets: 0,
      status: 'processing',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([mockBatch]);

    await createUploadBatch(mockDb as never, validInput);

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        totalAssets: 5,
        status: 'processing',
      })
    );
  });
});
