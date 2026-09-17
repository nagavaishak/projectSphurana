import { isFeatureOn } from '@borradh-workspace/observability';
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
import { deleteOrganization } from './delete-organization.service.js';

describe('deleteOrganization', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFeatureOn).mockResolvedValue(true);
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    requesterId: 'user_123',
  };

  const existingOrg = {
    id: 'org_123',
    name: 'Test Organization',
    slug: 'test-org',
    createdAt: new Date(),
  };

  const ownerMember = {
    id: 'member_1',
    organizationId: 'org_123',
    userId: 'user_123',
    role: 'owner',
    createdAt: new Date(),
  };

  it('should delete organization when requester is owner', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst.mockResolvedValueOnce(ownerMember);

    const result = await deleteOrganization(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
      expect(result.data.deletedOrganizationId).toBe('org_123');
    }
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({
      deletedAt: expect.any(Date),
    });
  });

  it('should return NOT_FOUND when organization does not exist', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      deleteOrganization(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toContain(validInput.organizationId);
    });

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return FORBIDDEN when requester is not a member', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      deleteOrganization(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(error.message).toContain('not a member');
    });

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return FORBIDDEN when requester is admin (not owner)', async () => {
    const adminMember = { ...ownerMember, role: 'admin' };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst.mockResolvedValueOnce(adminMember);

    await expectResult(
      deleteOrganization(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(error.message).toContain('Only owners');
    });

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return FORBIDDEN when requester is regular member', async () => {
    const regularMember = { ...ownerMember, role: 'member' };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst.mockResolvedValueOnce(regularMember);

    await expectResult(
      deleteOrganization(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(error.message).toContain('Only owners');
    });

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      requesterId: 'user_123',
    };

    await expectResult(
      deleteOrganization(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing requesterId', async () => {
    const invalidInput = {
      organizationId: 'org_123',
    };

    await expectResult(
      deleteOrganization(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = {
      organizationId: '',
      requesterId: 'user_123',
    };

    await expectResult(
      deleteOrganization(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty requesterId', async () => {
    const invalidInput = {
      organizationId: 'org_123',
      requesterId: '',
    };

    await expectResult(
      deleteOrganization(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst.mockResolvedValueOnce(ownerMember);
    mockDb.update.mockImplementationOnce(() => {
      throw new Error('Database connection failed');
    });

    const result = await deleteOrganization(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
