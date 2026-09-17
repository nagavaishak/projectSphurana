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
import { getInvitationByToken } from './get-invitation-by-token.service.js';

describe('getInvitationByToken', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const token = '550e8400-e29b-41d4-a716-446655440000';
  const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const pendingInvitation = {
    id: token,
    organizationId: 'org_123',
    email: 'invitee@example.com',
    role: 'member',
    status: 'pending',
    expiresAt: futureDate,
    inviterId: 'inviter_123',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: '+15551234567',
    phoneCountry: 'US',
    country: 'US',
    // Sensitive/extra fields that must NOT leak into the response
    secretInternalField: 'do-not-leak',
    organization: { id: 'org_123', name: 'Test Org', slug: 'secret-slug' },
    inviter: { id: 'inviter_123', name: 'Owner Person', email: 'owner@x.com' },
  };

  it('should return invite details including prefill fields when found', async () => {
    mockDb.query.invitation.findFirst.mockResolvedValueOnce(pendingInvitation);

    const result = await getInvitationByToken(mockDb as never, { token });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(token);
      expect(result.data.organizationName).toBe('Test Org');
      expect(result.data.inviterName).toBe('Owner Person');
      expect(result.data.email).toBe('invitee@example.com');
      expect(result.data.role).toBe('member');
      expect(result.data.status).toBe('pending');
      expect(result.data.effectiveStatus).toBe('pending');
      expect(result.data.isExpired).toBe(false);
      // Prefill fields
      expect(result.data.firstName).toBe('Jane');
      expect(result.data.lastName).toBe('Doe');
      expect(result.data.phone).toBe('+15551234567');
      expect(result.data.phoneCountry).toBe('US');
      expect(result.data.country).toBe('US');
    }
  });

  it('should not leak anything beyond the whitelisted invite fields', async () => {
    mockDb.query.invitation.findFirst.mockResolvedValueOnce(pendingInvitation);

    const result = await getInvitationByToken(mockDb as never, { token });

    expect(result.success).toBe(true);
    if (result.success) {
      const keys = Object.keys(result.data).sort();
      expect(keys).toEqual(
        [
          'country',
          'effectiveStatus',
          'email',
          'expiresAt',
          'firstName',
          'id',
          'inviterName',
          'isExpired',
          'lastName',
          'organizationId',
          'organizationName',
          'phone',
          'phoneCountry',
          'role',
          'status',
        ].sort()
      );
      // No raw org/inviter objects or stray internal fields
      expect('secretInternalField' in result.data).toBe(false);
      expect('organization' in result.data).toBe(false);
      expect('inviter' in result.data).toBe(false);
      expect('inviterId' in result.data).toBe(false);
    }
  });

  it('should return NOT_FOUND when the token does not match any invitation', async () => {
    mockDb.query.invitation.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getInvitationByToken(mockDb as never, { token })
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
    });
  });

  it('should mark a pending-but-expired invite as expired (not an error)', async () => {
    mockDb.query.invitation.findFirst.mockResolvedValueOnce({
      ...pendingInvitation,
      expiresAt: pastDate,
    });

    const result = await getInvitationByToken(mockDb as never, { token });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('pending');
      expect(result.data.isExpired).toBe(true);
      expect(result.data.effectiveStatus).toBe('expired');
    }
  });

  it('should surface an accepted invite with its status (not an error)', async () => {
    mockDb.query.invitation.findFirst.mockResolvedValueOnce({
      ...pendingInvitation,
      status: 'accepted',
    });

    const result = await getInvitationByToken(mockDb as never, { token });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('accepted');
      expect(result.data.effectiveStatus).toBe('accepted');
      expect(result.data.isExpired).toBe(false);
    }
  });

  it('should return VALIDATION_ERROR for a missing token', async () => {
    await expectResult(
      getInvitationByToken(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
