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
import { removeMember } from './remove-member.service.js';

describe('removeMember', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  // Use valid UUIDs (schema requires UUID for organizationId, userId, and requesterId)
  const validInput = {
    organizationId: '550e8400-e29b-41d4-a716-446655440000',
    userId: '550e8400-e29b-41d4-a716-446655440002',
    requesterId: '550e8400-e29b-41d4-a716-446655440001',
  };

  const existingOrg = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'My Organization',
    slug: 'my-org',
    createdAt: new Date(),
  };

  const ownerRequester = {
    id: 'member_1',
    organizationId: '550e8400-e29b-41d4-a716-446655440000',
    userId: '550e8400-e29b-41d4-a716-446655440001',
    role: 'owner',
    createdAt: new Date(),
  };

  const memberTarget = {
    id: 'member_2',
    organizationId: '550e8400-e29b-41d4-a716-446655440000',
    userId: '550e8400-e29b-41d4-a716-446655440002',
    role: 'member',
    createdAt: new Date(),
  };

  it('should remove member when requester is owner', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst
      .mockResolvedValueOnce(ownerRequester) // requester check
      .mockResolvedValueOnce(memberTarget); // target check

    const result = await removeMember(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.removedUserId).toBe(validInput.userId);
      expect(result.data.organizationId).toBe(validInput.organizationId);
    }
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('should allow user to remove themselves', async () => {
    const selfRemoveInput = {
      organizationId: '550e8400-e29b-41d4-a716-446655440000',
      userId: '550e8400-e29b-41d4-a716-446655440003',
      requesterId: '550e8400-e29b-41d4-a716-446655440003',
    };

    const selfMember = {
      id: 'member_self',
      organizationId: '550e8400-e29b-41d4-a716-446655440000',
      userId: '550e8400-e29b-41d4-a716-446655440003',
      role: 'member',
      createdAt: new Date(),
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst
      .mockResolvedValueOnce(selfMember)
      .mockResolvedValueOnce(selfMember);

    const result = await removeMember(mockDb as never, selfRemoveInput);

    expect(result.success).toBe(true);
  });

  it('should return NOT_FOUND when organization does not exist', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);

    await expectResult(removeMember(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(error.message).toContain(validInput.organizationId);
      }
    );
  });

  it('should return FORBIDDEN when requester is not a member', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst.mockResolvedValueOnce(null);

    await expectResult(removeMember(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.FORBIDDEN);
        expect(error.message).toContain('not a member');
      }
    );
  });

  it('should return NOT_FOUND when target user is not a member', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst
      .mockResolvedValueOnce(ownerRequester)
      .mockResolvedValueOnce(null);

    await expectResult(removeMember(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(error.message).toContain('not a member');
      }
    );
  });

  it('should return FORBIDDEN when regular member tries to remove others', async () => {
    const regularRequester = { ...ownerRequester, role: 'member' };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst
      .mockResolvedValueOnce(regularRequester)
      .mockResolvedValueOnce(memberTarget);

    await expectResult(removeMember(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.FORBIDDEN);
        expect(error.message).toContain('owners and admins');
      }
    );
  });

  it('should return FORBIDDEN when admin tries to remove owner', async () => {
    const adminRequester = { ...ownerRequester, role: 'admin' };
    const ownerTarget = { ...memberTarget, role: 'owner' };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst
      .mockResolvedValueOnce(adminRequester)
      .mockResolvedValueOnce(ownerTarget);

    await expectResult(removeMember(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.FORBIDDEN);
        expect(error.message).toContain('Only owners can remove');
      }
    );
  });

  it('should return FORBIDDEN when trying to remove last owner', async () => {
    const _ownerTarget = { ...memberTarget, role: 'owner' };
    const removeLastOwnerInput = {
      ...validInput,
      userId: '550e8400-e29b-41d4-a716-446655440001', // owner removing themselves
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst
      .mockResolvedValueOnce(ownerRequester)
      .mockResolvedValueOnce(ownerRequester); // same user
    mockDb.query.member.findMany.mockResolvedValueOnce([ownerRequester]); // only 1 owner

    await expectResult(
      removeMember(mockDb as never, removeLastOwnerInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(error.message).toContain('last owner');
    });
  });

  it('should allow removing owner when multiple owners exist', async () => {
    const ownerTarget = {
      ...memberTarget,
      userId: '550e8400-e29b-41d4-a716-446655440004',
      role: 'owner',
    };
    const removeOwnerInput = {
      ...validInput,
      userId: '550e8400-e29b-41d4-a716-446655440004',
    };
    const multipleOwners = [
      ownerRequester,
      {
        ...ownerRequester,
        id: 'member_3',
        userId: '550e8400-e29b-41d4-a716-446655440004',
      },
    ];

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst
      .mockResolvedValueOnce(ownerRequester)
      .mockResolvedValueOnce(ownerTarget);
    mockDb.query.member.findMany.mockResolvedValueOnce(multipleOwners);

    const result = await removeMember(mockDb as never, removeOwnerInput);

    expect(result.success).toBe(true);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      userId: 'user_to_remove',
      requesterId: 'user_requester',
    };

    await expectResult(
      removeMember(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst
      .mockResolvedValueOnce(ownerRequester)
      .mockResolvedValueOnce(memberTarget);
    mockDb.delete.mockImplementationOnce(() => {
      throw new Error('Database error');
    });

    const result = await removeMember(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
