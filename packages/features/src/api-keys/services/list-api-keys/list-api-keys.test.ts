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
import { listApiKeys } from './list-api-keys.service.js';

describe('listApiKeys', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
  };

  it('should return API keys for the organization', async () => {
    const mockRows = [
      {
        id: 'key_1',
        name: 'Production',
        start: 'abc123',
        prefix: 'brd',
        enabled: true,
        expiresAt: null,
        createdAt: new Date('2024-01-01'),
        lastRequest: new Date('2024-06-01'),
        metadata: { organizationId: 'org_123', scopes: ['leads:read'] },
        rateLimitMax: 500,
      },
      {
        id: 'key_2',
        name: 'Staging',
        start: 'def456',
        prefix: 'brd',
        enabled: false,
        expiresAt: new Date('2025-01-01'),
        createdAt: new Date('2024-02-01'),
        lastRequest: null,
        metadata: {
          organizationId: 'org_123',
          scopes: ['leads:read', 'leads:write'],
        },
        rateLimitMax: 500,
      },
    ];

    // The service uses db.select().from().where().orderBy()
    // The last chainable call in the chain resolves the promise
    mockDb.orderBy.mockResolvedValueOnce(mockRows);

    const result = await listApiKeys(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.items[0].name).toBe('Production');
      expect(result.data.items[0].scopes).toEqual(['leads:read']);
      expect(result.data.items[1].enabled).toBe(false);
    }
  });

  it('should return empty array when no keys exist', async () => {
    mockDb.orderBy.mockResolvedValueOnce([]);

    const result = await listApiKeys(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(0);
    }
  });

  it('should extract scopes from metadata', async () => {
    const mockRows = [
      {
        id: 'key_1',
        name: 'Test',
        start: 'abc',
        prefix: 'brd',
        enabled: true,
        expiresAt: null,
        createdAt: new Date(),
        lastRequest: null,
        metadata: {
          organizationId: 'org_123',
          scopes: ['assets:read', 'assets:write'],
        },
        rateLimitMax: 1000,
      },
    ];

    mockDb.orderBy.mockResolvedValueOnce(mockRows);

    const result = await listApiKeys(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].scopes).toEqual([
        'assets:read',
        'assets:write',
      ]);
    }
  });

  it('should default scopes to empty array when metadata has no scopes', async () => {
    const mockRows = [
      {
        id: 'key_1',
        name: 'Old Key',
        start: 'abc',
        prefix: 'brd',
        enabled: true,
        expiresAt: null,
        createdAt: new Date(),
        lastRequest: null,
        metadata: { organizationId: 'org_123' },
        rateLimitMax: null,
      },
    ];

    mockDb.orderBy.mockResolvedValueOnce(mockRows);

    const result = await listApiKeys(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].scopes).toEqual([]);
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      listApiKeys(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      listApiKeys(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
