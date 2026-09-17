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
import { getOrganizationMembers } from './get-organization-members.service.js';

describe('getOrganizationMembers', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  // Use valid UUIDs (schema requires UUID)
  const validInput = {
    organizationId: '550e8400-e29b-41d4-a716-446655440000',
  };

  const existingOrg = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'My Organization',
    slug: 'my-org',
    createdAt: new Date(),
  };

  it('should return members list when organization exists', async () => {
    const mockMembers = [
      {
        id: 'member_1',
        userId: 'user_1',
        role: 'owner',
        createdAt: new Date(),
        user: {
          id: 'user_1',
          name: 'John Doe',
          email: 'john@example.com',
          image: null,
        },
      },
      {
        id: 'member_2',
        userId: 'user_2',
        role: 'member',
        createdAt: new Date(),
        user: {
          id: 'user_2',
          name: 'Jane Smith',
          email: 'jane@example.com',
          image: 'https://example.com/avatar.png',
        },
      },
    ];

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findMany.mockResolvedValueOnce(mockMembers);

    const result = await getOrganizationMembers(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].role).toBe('owner');
      expect(result.data[0].user.name).toBe('John Doe');
      expect(result.data[1].user.image).toBe('https://example.com/avatar.png');
    }
  });

  it('should return empty array when no members', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findMany.mockResolvedValueOnce([]);

    const result = await getOrganizationMembers(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
    }
  });

  it('should return NOT_FOUND when organization does not exist', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getOrganizationMembers(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toContain(validInput.organizationId);
    });
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {};

    await expectResult(
      getOrganizationMembers(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = { organizationId: '' };

    await expectResult(
      getOrganizationMembers(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findMany.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(
      getOrganizationMembers(mockDb as never, validInput)
    ).rejects.toThrow('Database connection failed');
  });
});
