import { drizzleUniqueViolation } from '@borradh-workspace/database';
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
import { updatePractitioner } from './update-practitioner.service.js';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const PRAC_ID = 'prac-1';

const mockPractitioner = {
  id: PRAC_ID,
  organizationId: ORG_ID,
  name: 'Jane Doe Updated',
  email: 'jane@example.com',
  phone: null,
  photo: null,
  bio: null,
  title: null,
  isActive: true,
  userId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('updatePractitioner', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockDb.returning.mockReset();
    mockDb.returning.mockResolvedValue([]);
  });

  it('updates practitioner with valid input', async () => {
    mockDb.returning.mockResolvedValueOnce([mockPractitioner]);

    const result = await updatePractitioner(mockDb as never, {
      id: PRAC_ID,
      organizationId: ORG_ID,
      name: 'Jane Doe Updated',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Jane Doe Updated');
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('applies a partial update of the new profile / work-detail fields', async () => {
    mockDb.returning.mockResolvedValueOnce([mockPractitioner]);

    const result = await updatePractitioner(mockDb as never, {
      id: PRAC_ID,
      organizationId: ORG_ID,
      country: 'ie',
      employmentType: 'part_time',
      teamMemberRef: 'PAY-99',
      acceptsBookings: false,
      headline: 'Colour specialist',
      languages: ['English'],
      socialLinks: { tiktok: 'jane' },
    });

    expect(result.success).toBe(true);
    const setCall = mockDb.set.mock.calls[0]?.[0];
    expect(setCall).toEqual(
      expect.objectContaining({
        country: 'ie',
        employmentType: 'part_time',
        teamMemberRef: 'PAY-99',
        acceptsBookings: false,
        headline: 'Colour specialist',
        languages: ['English'],
        socialLinks: { tiktok: 'jane' },
      })
    );
  });

  it('re-derives `name` from first/last when name is omitted', async () => {
    mockDb.returning.mockResolvedValueOnce([mockPractitioner]);

    await updatePractitioner(mockDb as never, {
      id: PRAC_ID,
      organizationId: ORG_ID,
      firstName: 'Jane',
      lastName: 'Smith',
    });

    const setCall = mockDb.set.mock.calls[0]?.[0];
    expect(setCall?.name).toBe('Jane Smith');
  });

  it('returns VALIDATION_ERROR for an invalid employmentType', async () => {
    await expectResult(
      updatePractitioner(mockDb as never, {
        id: PRAC_ID,
        organizationId: ORG_ID,
        employmentType: 'freelance' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when practitioner does not exist', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      updatePractitioner(mockDb as never, {
        id: 'nonexistent',
        organizationId: ORG_ID,
        name: 'Updated',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR when no fields to update', async () => {
    await expectResult(
      updatePractitioner(mockDb as never, {
        id: PRAC_ID,
        organizationId: ORG_ID,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for empty id', async () => {
    await expectResult(
      updatePractitioner(mockDb as never, {
        id: '',
        organizationId: ORG_ID,
        name: 'Test',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for invalid email', async () => {
    await expectResult(
      updatePractitioner(mockDb as never, {
        id: PRAC_ID,
        organizationId: ORG_ID,
        email: 'not-an-email',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  // Drizzle-shaped: constraint name on `cause`, not on the wrapper's message
  // (see the matching note in create-practitioner.test.ts — ENG-721).
  it('returns ALREADY_EXISTS for duplicate email in org', async () => {
    mockDb.returning.mockRejectedValueOnce(
      drizzleUniqueViolation('practitioner_org_email_unique')
    );

    await expectResult(
      updatePractitioner(mockDb as never, {
        id: PRAC_ID,
        organizationId: ORG_ID,
        email: 'duplicate@example.com',
      })
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });

  it('returns INTERNAL_ERROR on unexpected DB failure', async () => {
    mockDb.returning.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expectResult(
      updatePractitioner(mockDb as never, {
        id: PRAC_ID,
        organizationId: ORG_ID,
        name: 'Updated',
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
