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
import { linkPractitionerToUser } from './link-practitioner-to-user.service.js';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const USER_ID = 'user-1';

const mockPractitioner = {
  id: 'prac-1',
  organizationId: ORG_ID,
  name: 'Jane Doe',
  email: 'jane@example.com',
  userId: null,
  isActive: true,
};

describe('linkPractitionerToUser', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockDb.returning.mockReset();
    mockDb.returning.mockResolvedValue([]);
  });

  it('links practitioner to user successfully', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(mockPractitioner);
    mockDb.returning.mockResolvedValueOnce([
      { ...mockPractitioner, userId: USER_ID },
    ]);

    const result = await linkPractitionerToUser(mockDb as never, {
      userId: USER_ID,
      organizationId: ORG_ID,
      email: 'jane@example.com',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userId).toBe(USER_ID);
    }
  });

  it('clears the invitation hold when the practitioner gains an account (ENG-794)', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      ...mockPractitioner,
      invitationPending: true,
    });
    mockDb.returning.mockResolvedValueOnce([
      { ...mockPractitioner, userId: USER_ID, invitationPending: false },
    ]);

    await linkPractitionerToUser(mockDb as never, {
      userId: USER_ID,
      organizationId: ORG_ID,
      email: 'jane@example.com',
    });

    // Linking IS acceptance: this is the moment an invitee becomes a real
    // practitioner, so the hold on their bookability is released here rather
    // than being left for someone to remember to clear.
    expect(mockDb.set).toHaveBeenCalledWith({
      userId: USER_ID,
      invitationPending: false,
    });
  });

  it('returns ok idempotently when already linked to same user', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      ...mockPractitioner,
      userId: USER_ID,
    });

    const result = await linkPractitionerToUser(mockDb as never, {
      userId: USER_ID,
      organizationId: ORG_ID,
      email: 'jane@example.com',
    });

    expect(result.success).toBe(true);
    // Should not attempt to update since already linked
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns CONFLICT when linked to a different user', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      ...mockPractitioner,
      userId: 'other-user',
    });

    await expectResult(
      linkPractitionerToUser(mockDb as never, {
        userId: USER_ID,
        organizationId: ORG_ID,
        email: 'jane@example.com',
      })
    ).toFailWithCode(ErrorCodes.CONFLICT);
  });

  it('returns CONFLICT on concurrent linking race condition', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(mockPractitioner);
    // Update returns empty (another user linked concurrently)
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      linkPractitionerToUser(mockDb as never, {
        userId: USER_ID,
        organizationId: ORG_ID,
        email: 'jane@example.com',
      })
    ).toFailWithCode(ErrorCodes.CONFLICT);
  });

  it('returns NOT_FOUND when no practitioner with email in org', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      linkPractitionerToUser(mockDb as never, {
        userId: USER_ID,
        organizationId: ORG_ID,
        email: 'nonexistent@example.com',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for empty userId', async () => {
    await expectResult(
      linkPractitionerToUser(mockDb as never, {
        userId: '',
        organizationId: ORG_ID,
        email: 'jane@example.com',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for invalid email', async () => {
    await expectResult(
      linkPractitionerToUser(mockDb as never, {
        userId: USER_ID,
        organizationId: ORG_ID,
        email: 'not-an-email',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(mockPractitioner);
    mockDb.returning.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expectResult(
      linkPractitionerToUser(mockDb as never, {
        userId: USER_ID,
        organizationId: ORG_ID,
        email: 'jane@example.com',
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
