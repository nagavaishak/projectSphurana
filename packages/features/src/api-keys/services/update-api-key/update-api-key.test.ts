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
import { updateApiKey } from './update-api-key.service.js';

describe('updateApiKey', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    keyId: 'key_123',
    organizationId: 'org_123',
    name: 'Updated Name',
  };

  const mockUpdatedRow = {
    id: 'key_123',
    name: 'Updated Name',
    start: 'abc',
    prefix: 'brd',
    enabled: true,
    expiresAt: null,
    createdAt: new Date(),
    lastRequest: null,
    metadata: { organizationId: 'org_123', scopes: ['leads:read'] },
    rateLimitMax: 500,
  };

  it('should update an existing key name', async () => {
    // Ownership check: select().from().where().limit()
    mockDb.where.mockImplementationOnce(() => mockDb);
    mockDb.limit.mockResolvedValueOnce([{ id: 'key_123' }]);
    // Update: update().set().where().returning()
    mockDb.returning.mockResolvedValueOnce([mockUpdatedRow]);

    const result = await updateApiKey(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Updated Name');
      expect(result.data.scopes).toEqual(['leads:read']);
    }
  });

  it('should toggle enabled status', async () => {
    const disabledRow = {
      ...mockUpdatedRow,
      name: 'Test',
      enabled: false,
      metadata: { organizationId: 'org_123', scopes: [] },
    };

    mockDb.where.mockImplementationOnce(() => mockDb);
    mockDb.limit.mockResolvedValueOnce([{ id: 'key_123' }]);
    mockDb.returning.mockResolvedValueOnce([disabledRow]);

    const result = await updateApiKey(mockDb as never, {
      keyId: 'key_123',
      organizationId: 'org_123',
      enabled: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
    }
  });

  it('should return NOT_FOUND when key does not exist', async () => {
    mockDb.where.mockImplementationOnce(() => mockDb);
    mockDb.limit.mockResolvedValueOnce([]);

    await expectResult(
      updateApiKey(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR when no fields to update', async () => {
    await expectResult(
      updateApiKey(mockDb as never, {
        keyId: 'key_123',
        organizationId: 'org_123',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing keyId', async () => {
    await expectResult(
      updateApiKey(
        mockDb as never,
        {
          organizationId: 'org_123',
          name: 'Test',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      updateApiKey(
        mockDb as never,
        {
          keyId: 'key_123',
          name: 'Test',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should default scopes to empty array when metadata has no scopes', async () => {
    const rowWithoutScopes = {
      ...mockUpdatedRow,
      metadata: { organizationId: 'org_123' },
    };

    mockDb.where.mockImplementationOnce(() => mockDb);
    mockDb.limit.mockResolvedValueOnce([{ id: 'key_123' }]);
    mockDb.returning.mockResolvedValueOnce([rowWithoutScopes]);

    const result = await updateApiKey(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scopes).toEqual([]);
    }
  });
});
