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
import { acceptInvitation } from './accept-invitation.service.js';

describe('acceptInvitation', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    invitationId: '550e8400-e29b-41d4-a716-446655440000',
    userId: '550e8400-e29b-41d4-a716-446655440001',
  };

  const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago

  const pendingInvitation = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    organizationId: 'org_123',
    email: 'test@example.com',
    role: 'member',
    status: 'pending',
    expiresAt: futureDate,
    inviterId: 'inviter_123',
    organization: {
      id: 'org_123',
      name: 'Test Org',
    },
  };

  const existingUser = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    email: 'test@example.com',
    name: 'Test User',
    emailVerified: true,
  };

  it('should accept invitation successfully', async () => {
    const mockMember = {
      id: 'member_new',
      organizationId: 'org_123',
      userId: validInput.userId,
      role: 'member',
      createdAt: new Date(),
    };

    mockDb.query.invitation.findFirst.mockResolvedValueOnce(pendingInvitation);
    mockDb.query.user.findFirst.mockResolvedValueOnce(existingUser);
    mockDb.query.member.findFirst.mockResolvedValueOnce(null); // Not already a member
    mockDb.returning.mockResolvedValueOnce([mockMember]);

    const result = await acceptInvitation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.organizationId).toBe('org_123');
      expect(result.data.userId).toBe(validInput.userId);
      expect(result.data.role).toBe('member');
    }
  });

  it('marks the email verified on accept when the user is unverified', async () => {
    const unverifiedUser = { ...existingUser, emailVerified: false };
    mockDb.query.invitation.findFirst.mockResolvedValueOnce(pendingInvitation);
    mockDb.query.user.findFirst.mockResolvedValueOnce(unverifiedUser);
    mockDb.query.member.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'member_new',
        organizationId: 'org_123',
        userId: validInput.userId,
        role: 'member',
        createdAt: new Date(),
      },
    ]);

    const result = await acceptInvitation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ emailVerified: true })
    );
  });

  it('should set role from invitation, stamp termsAcceptedAt, and copy prefill onto the practitioner', async () => {
    const adminInvitation = {
      ...pendingInvitation,
      role: 'admin',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+15551234567',
      phoneCountry: 'US',
      country: 'us',
    };
    const mockMember = {
      id: 'member_new',
      organizationId: 'org_123',
      userId: validInput.userId,
      role: 'admin',
      createdAt: new Date(),
    };
    const linkedPractitioner = {
      id: 'prac_1',
      organizationId: 'org_123',
      userId: null,
      email: existingUser.email,
    };

    mockDb.query.invitation.findFirst.mockResolvedValueOnce(adminInvitation);
    mockDb.query.user.findFirst.mockResolvedValueOnce(existingUser);
    mockDb.query.member.findFirst.mockResolvedValueOnce(null);
    // Practitioner lookup inside linkPractitionerToUser
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(
      linkedPractitioner
    );
    mockDb.returning
      .mockResolvedValueOnce([mockMember]) // member insert
      .mockResolvedValueOnce([
        { ...linkedPractitioner, userId: validInput.userId },
      ]); // link update

    const result = await acceptInvitation(mockDb as never, {
      ...validInput,
      acceptedTerms: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe('admin');
      expect(result.data.practitionerId).toBe('prac_1');
    }

    // Member inserted with role from invitation + terms timestamp
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'admin',
        termsAcceptedAt: expect.any(Date),
      })
    );

    // Prefill copied onto the practitioner (valid country coerced through)
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Jane',
        lastName: 'Doe',
        phone: '+15551234567',
        country: 'us',
      })
    );
  });

  it('should not stamp termsAcceptedAt when acceptedTerms is not passed', async () => {
    const mockMember = {
      id: 'member_new',
      organizationId: 'org_123',
      userId: validInput.userId,
      role: 'member',
      createdAt: new Date(),
    };

    mockDb.query.invitation.findFirst.mockResolvedValueOnce(pendingInvitation);
    mockDb.query.user.findFirst.mockResolvedValueOnce(existingUser);
    mockDb.query.member.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([mockMember]);

    const result = await acceptInvitation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ termsAcceptedAt: null })
    );
  });

  it('should skip country coercion when invitation.country is not a valid enum value', async () => {
    const badCountryInvitation = {
      ...pendingInvitation,
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+15551234567',
      country: 'ZZ', // not a valid country enum value
    };
    const mockMember = {
      id: 'member_new',
      organizationId: 'org_123',
      userId: validInput.userId,
      role: 'member',
      createdAt: new Date(),
    };
    const linkedPractitioner = {
      id: 'prac_1',
      organizationId: 'org_123',
      userId: null,
      email: existingUser.email,
    };

    mockDb.query.invitation.findFirst.mockResolvedValueOnce(
      badCountryInvitation
    );
    mockDb.query.user.findFirst.mockResolvedValueOnce(existingUser);
    mockDb.query.member.findFirst.mockResolvedValueOnce(null);
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(
      linkedPractitioner
    );
    mockDb.returning
      .mockResolvedValueOnce([mockMember])
      .mockResolvedValueOnce([
        { ...linkedPractitioner, userId: validInput.userId },
      ]);

    const result = await acceptInvitation(mockDb as never, {
      ...validInput,
      acceptedTerms: true,
    });

    expect(result.success).toBe(true);
    // Prefill still copies name/phone
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Jane',
        phone: '+15551234567',
      })
    );
    // But never with the invalid country value
    const setCalls = mockDb.set.mock.calls;
    for (const [arg] of setCalls) {
      expect(arg).not.toHaveProperty('country', 'ZZ');
    }
  });

  it('should return NOT_FOUND when invitation does not exist', async () => {
    mockDb.query.invitation.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      acceptInvitation(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toContain('Invitation not found');
    });
  });

  it('should return CONFLICT when invitation is not pending', async () => {
    const acceptedInvitation = { ...pendingInvitation, status: 'accepted' };

    mockDb.query.invitation.findFirst.mockResolvedValueOnce(acceptedInvitation);

    await expectResult(
      acceptInvitation(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.CONFLICT);
      expect(error.message).toContain('already been used');
    });
  });

  it('should return CONFLICT when invitation has expired', async () => {
    const expiredInvitation = { ...pendingInvitation, expiresAt: pastDate };

    mockDb.query.invitation.findFirst.mockResolvedValueOnce(expiredInvitation);

    await expectResult(
      acceptInvitation(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.CONFLICT);
      expect(error.message).toContain('expired');
    });
  });

  it('should return NOT_FOUND when user does not exist', async () => {
    mockDb.query.invitation.findFirst.mockResolvedValueOnce(pendingInvitation);
    mockDb.query.user.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      acceptInvitation(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toContain('User not found');
    });
  });

  it('should return FORBIDDEN when user email does not match invitation email', async () => {
    const differentUser = {
      ...existingUser,
      email: 'different@example.com',
    };

    mockDb.query.invitation.findFirst.mockResolvedValueOnce(pendingInvitation);
    mockDb.query.user.findFirst.mockResolvedValueOnce(differentUser);

    await expectResult(
      acceptInvitation(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(error.message).toContain('different email');
    });
  });

  it('should return ALREADY_EXISTS when user is already a member', async () => {
    const existingMembership = {
      id: 'member_existing',
      organizationId: 'org_123',
      userId: validInput.userId,
      role: 'member',
    };

    mockDb.query.invitation.findFirst.mockResolvedValueOnce(pendingInvitation);
    mockDb.query.user.findFirst.mockResolvedValueOnce(existingUser);
    mockDb.query.member.findFirst.mockResolvedValueOnce(existingMembership);

    await expectResult(
      acceptInvitation(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.ALREADY_EXISTS);
      expect(error.message).toContain('already a member');
    });
  });

  it('should return VALIDATION_ERROR for missing invitationId', async () => {
    const invalidInput = {
      userId: '550e8400-e29b-41d4-a716-446655440001',
    };

    await expectResult(
      acceptInvitation(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing userId', async () => {
    const invalidInput = {
      invitationId: '550e8400-e29b-41d4-a716-446655440000',
    };

    await expectResult(
      acceptInvitation(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.invitation.findFirst.mockResolvedValueOnce(pendingInvitation);
    mockDb.query.user.findFirst.mockResolvedValueOnce(existingUser);
    mockDb.query.member.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockRejectedValueOnce(new Error('Database error'));

    const result = await acceptInvitation(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
