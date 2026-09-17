import { sendEmail } from '@borradh-workspace/email';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { inviteMember } from './invite-member.service.js';

// `@borradh-workspace/env/auth` is aliased to the canonical static mock
// (vite.config.ts → __mocks__/env-auth.ts, which now carries WEB_URL /
// BETTER_AUTH_SECRET / BETTER_AUTH_URL). NEVER `vi.mock` an aliased module —
// under `isolate: false` the factory persists on the shared worker graph and
// poisons later files.

describe('inviteMember', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    vi.mocked(sendEmail).mockResolvedValue(undefined as never);
  });

  const validInput = {
    organizationId: '550e8400-e29b-41d4-a716-446655440000',
    email: 'newmember@example.com',
    role: 'member' as const,
    inviterId: '550e8400-e29b-41d4-a716-446655440001',
  };

  const existingOrg = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'My Organization',
    slug: 'my-org',
    createdAt: new Date(),
  };

  const ownerMember = {
    id: 'member_1',
    organizationId: '550e8400-e29b-41d4-a716-446655440000',
    userId: '550e8400-e29b-41d4-a716-446655440001',
    role: 'owner',
    createdAt: new Date(),
  };

  it('should create invitation when inviter is owner', async () => {
    const mockInvitation = {
      id: 'inv_123',
      organizationId: validInput.organizationId,
      email: validInput.email,
      role: validInput.role,
      status: 'pending',
      expiresAt: new Date(),
      inviterId: validInput.inviterId,
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst.mockResolvedValueOnce(ownerMember);
    mockDb.query.user.findFirst.mockResolvedValueOnce(null); // No existing user
    mockDb.query.invitation.findFirst.mockResolvedValueOnce(null); // No pending invitation
    mockDb.returning.mockResolvedValueOnce([mockInvitation]);

    const result = await inviteMember(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe(validInput.email);
      expect(result.data.status).toBe('pending');
    }
  });

  it('should persist prefill fields on the invitation', async () => {
    const prefillInput = {
      ...validInput,
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+15551234567',
      phoneCountry: 'US',
      country: 'US',
    };

    const mockInvitation = {
      id: 'inv_123',
      organizationId: prefillInput.organizationId,
      email: prefillInput.email,
      role: prefillInput.role,
      status: 'pending',
      expiresAt: new Date(),
      inviterId: prefillInput.inviterId,
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+15551234567',
      phoneCountry: 'US',
      country: 'US',
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst.mockResolvedValueOnce(ownerMember);
    mockDb.query.user.findFirst.mockResolvedValueOnce(null);
    mockDb.query.invitation.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([mockInvitation]);

    const result = await inviteMember(mockDb as never, prefillInput);

    expect(result.success).toBe(true);
    // Insert receives the prefill fields
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Jane',
        lastName: 'Doe',
        phone: '+15551234567',
        phoneCountry: 'US',
        country: 'US',
      })
    );
    if (result.success) {
      expect(result.data.firstName).toBe('Jane');
      expect(result.data.lastName).toBe('Doe');
      expect(result.data.phone).toBe('+15551234567');
      expect(result.data.phoneCountry).toBe('US');
      expect(result.data.country).toBe('US');
    }
  });

  it('should default prefill fields to null when omitted', async () => {
    const mockInvitation = {
      id: 'inv_123',
      organizationId: validInput.organizationId,
      email: validInput.email,
      role: validInput.role,
      status: 'pending',
      expiresAt: new Date(),
      inviterId: validInput.inviterId,
      firstName: null,
      lastName: null,
      phone: null,
      phoneCountry: null,
      country: null,
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst.mockResolvedValueOnce(ownerMember);
    mockDb.query.user.findFirst.mockResolvedValueOnce(null);
    mockDb.query.invitation.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([mockInvitation]);

    const result = await inviteMember(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: null,
        lastName: null,
        phone: null,
        phoneCountry: null,
        country: null,
      })
    );
  });

  it('should create invitation when inviter is admin', async () => {
    const adminMember = { ...ownerMember, role: 'admin' };
    const mockInvitation = {
      id: 'inv_123',
      organizationId: validInput.organizationId,
      email: validInput.email,
      role: validInput.role,
      status: 'pending',
      expiresAt: new Date(),
      inviterId: validInput.inviterId,
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst.mockResolvedValueOnce(adminMember);
    mockDb.query.user.findFirst.mockResolvedValueOnce(null);
    mockDb.query.invitation.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([mockInvitation]);

    const result = await inviteMember(mockDb as never, validInput);

    expect(result.success).toBe(true);
  });

  it('should return NOT_FOUND when organization does not exist', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);

    await expectResult(inviteMember(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(error.message).toContain(validInput.organizationId);
      }
    );
  });

  it('should return FORBIDDEN when inviter is not a member', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst.mockResolvedValueOnce(null);

    await expectResult(inviteMember(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.FORBIDDEN);
        expect(error.message).toContain('not a member');
      }
    );
  });

  it('should return FORBIDDEN when inviter is regular member', async () => {
    const regularMember = { ...ownerMember, role: 'member' };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst.mockResolvedValueOnce(regularMember);

    await expectResult(inviteMember(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.FORBIDDEN);
        expect(error.message).toContain('owners and admins');
      }
    );
  });

  it('should return ALREADY_EXISTS when user is already a member', async () => {
    const existingUser = { id: 'existing_user', email: validInput.email };
    const existingMembership = {
      id: 'member_2',
      organizationId: validInput.organizationId,
      userId: 'existing_user',
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst
      .mockResolvedValueOnce(ownerMember) // inviter check
      .mockResolvedValueOnce(existingMembership); // existing member check
    mockDb.query.user.findFirst.mockResolvedValueOnce(existingUser);

    await expectResult(inviteMember(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.ALREADY_EXISTS);
        expect(error.message).toContain('already a member');
      }
    );
  });

  it('should return ALREADY_EXISTS when invitation is pending', async () => {
    const pendingInvitation = {
      id: 'existing_inv',
      email: validInput.email,
      status: 'pending',
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst.mockResolvedValueOnce(ownerMember);
    mockDb.query.user.findFirst.mockResolvedValueOnce(null);
    mockDb.query.invitation.findFirst.mockResolvedValueOnce(pendingInvitation);

    await expectResult(inviteMember(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.ALREADY_EXISTS);
        expect(error.message).toContain('invitation is already pending');
      }
    );
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      email: 'newmember@example.com',
      role: 'member' as const,
      inviterId: '550e8400-e29b-41d4-a716-446655440001',
    };

    await expectResult(
      inviteMember(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid email', async () => {
    const invalidInput = {
      ...validInput,
      email: 'invalid-email',
    };

    await expectResult(
      inviteMember(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.member.findFirst.mockResolvedValueOnce(ownerMember);
    mockDb.query.user.findFirst.mockResolvedValueOnce(null);
    mockDb.query.invitation.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockRejectedValueOnce(new Error('Database error'));

    const result = await inviteMember(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
