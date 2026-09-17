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
import { listPendingInvitations } from './list-pending-invitations.service.js';

describe('listPendingInvitations', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    email: 'test@example.com',
  };

  const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  it('should return pending invitations for a valid email', async () => {
    const mockInvitations = [
      {
        id: 'inv_1',
        organizationId: 'org_1',
        email: 'test@example.com',
        role: 'member',
        status: 'pending',
        expiresAt: futureDate,
        organization: { id: 'org_1', name: 'Org One' },
        inviter: { id: 'user_1', name: 'Inviter One' },
      },
      {
        id: 'inv_2',
        organizationId: 'org_2',
        email: 'test@example.com',
        role: 'admin',
        status: 'pending',
        expiresAt: futureDate,
        organization: { id: 'org_2', name: 'Org Two' },
        inviter: { id: 'user_2', name: 'Inviter Two' },
      },
    ];

    mockDb.query.invitation.findMany.mockResolvedValueOnce(mockInvitations);

    const result = await listPendingInvitations(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toBe('inv_1');
      expect(result.data[0].organizationName).toBe('Org One');
      expect(result.data[0].inviterName).toBe('Inviter One');
      expect(result.data[0].role).toBe('member');
      expect(result.data[1].id).toBe('inv_2');
      expect(result.data[1].organizationName).toBe('Org Two');
      expect(result.data[1].inviterName).toBe('Inviter Two');
      expect(result.data[1].role).toBe('admin');
    }
  });

  it('should return empty array when no pending invitations exist', async () => {
    mockDb.query.invitation.findMany.mockResolvedValueOnce([]);

    const result = await listPendingInvitations(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  it('should handle invitations with null organization name', async () => {
    const mockInvitations = [
      {
        id: 'inv_1',
        organizationId: 'org_1',
        email: 'test@example.com',
        role: 'member',
        status: 'pending',
        expiresAt: futureDate,
        organization: null,
        inviter: null,
      },
    ];

    mockDb.query.invitation.findMany.mockResolvedValueOnce(mockInvitations);

    const result = await listPendingInvitations(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].organizationName).toBe('Unknown');
      expect(result.data[0].inviterName).toBeNull();
    }
  });

  it('should handle invitations with null inviter', async () => {
    const mockInvitations = [
      {
        id: 'inv_1',
        organizationId: 'org_1',
        email: 'test@example.com',
        role: 'member',
        status: 'pending',
        expiresAt: futureDate,
        organization: { id: 'org_1', name: 'Org One' },
        inviter: null,
      },
    ];

    mockDb.query.invitation.findMany.mockResolvedValueOnce(mockInvitations);

    const result = await listPendingInvitations(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].inviterName).toBeNull();
    }
  });

  it('should return VALIDATION_ERROR for invalid email', async () => {
    const invalidInput = { email: 'not-an-email' };

    await expectResult(
      listPendingInvitations(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.invitation.findMany).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing email', async () => {
    const invalidInput = {};

    await expectResult(
      listPendingInvitations(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.invitation.findMany).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty email', async () => {
    const invalidInput = { email: '' };

    await expectResult(
      listPendingInvitations(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.invitation.findMany).not.toHaveBeenCalled();
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.invitation.findMany.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(
      listPendingInvitations(mockDb as never, validInput)
    ).rejects.toThrow('Database connection failed');
  });
});
