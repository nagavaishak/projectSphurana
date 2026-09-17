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
import { getOrganizationWithMembers } from './get-organization-with-members.service.js';

describe('getOrganizationWithMembers', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
  };

  const existingOrg = {
    id: 'org_123',
    name: 'Test Salon',
    slug: 'test-salon',
    businessType: 'salon',
    logo: null,
    createdAt: new Date(),
  };

  const mockMemberRows = [
    {
      id: 'member_1',
      userId: 'user_1',
      role: 'owner',
      createdAt: new Date(),
      userName: 'John Doe',
      userEmail: 'john@example.com',
      userImage: null,
      userRole: 'admin',
      userId2: 'user_1',
    },
    {
      id: 'member_2',
      userId: 'user_2',
      role: 'member',
      createdAt: new Date(),
      userName: 'Jane Smith',
      userEmail: 'jane@example.com',
      userImage: 'https://example.com/avatar.png',
      userRole: null,
      userId2: 'user_2',
    },
  ];

  it('should return organization with members when found', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.where.mockResolvedValueOnce(mockMemberRows);

    const result = await getOrganizationWithMembers(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('org_123');
      expect(result.data.name).toBe('Test Salon');
      expect(result.data.slug).toBe('test-salon');
      expect(result.data.businessType).toBe('salon');
      expect(result.data.members).toHaveLength(2);
      expect(result.data.members[0].role).toBe('owner');
      expect(result.data.members[0].user.name).toBe('John Doe');
      expect(result.data.members[0].user.email).toBe('john@example.com');
      expect(result.data.members[1].user.image).toBe(
        'https://example.com/avatar.png'
      );
    }
  });

  it('should return organization with empty members list', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.where.mockResolvedValueOnce([]);

    const result = await getOrganizationWithMembers(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('org_123');
      expect(result.data.members).toHaveLength(0);
    }
  });

  it('should return NOT_FOUND when organization does not exist', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getOrganizationWithMembers(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {};

    await expectResult(
      getOrganizationWithMembers(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = { organizationId: '' };

    await expectResult(
      getOrganizationWithMembers(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.organization.findFirst).not.toHaveBeenCalled();
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.organization.findFirst.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(
      getOrganizationWithMembers(mockDb as never, validInput)
    ).rejects.toThrow('Database connection failed');
  });

  it('should handle member query database errors', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.where.mockRejectedValueOnce(new Error('Member query failed'));

    await expect(
      getOrganizationWithMembers(mockDb as never, validInput)
    ).rejects.toThrow('Member query failed');
  });
});
