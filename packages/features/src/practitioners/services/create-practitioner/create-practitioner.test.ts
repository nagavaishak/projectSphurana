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
import { createPractitioner } from './create-practitioner.service.js';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';

const validInput = {
  organizationId: ORG_ID,
  name: 'Jane Doe',
  email: 'jane@example.com',
};

const mockPractitioner = {
  id: 'prac-1',
  organizationId: ORG_ID,
  name: 'Jane Doe',
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

describe('createPractitioner', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockDb.returning.mockReset();
    mockDb.returning.mockResolvedValue([]);
  });

  it('creates a practitioner with valid input', async () => {
    mockDb.where.mockResolvedValueOnce([]);
    mockDb.returning.mockResolvedValueOnce([mockPractitioner]);

    const result = await createPractitioner(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Jane Doe');
      expect(result.data.email).toBe('jane@example.com');
    }
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('persists the new profile / work-detail / public-profile fields', async () => {
    mockDb.where.mockResolvedValueOnce([]); // pickUnusedColor
    mockDb.returning.mockResolvedValueOnce([mockPractitioner]);

    const result = await createPractitioner(mockDb as never, {
      ...validInput,
      phoneSecondary: '+353111222',
      phoneCountry: 'IE',
      country: 'ie',
      dateOfBirth: '1990-05-01',
      employmentStartDate: '2024-01-01',
      employmentEndDate: '2025-01-01',
      employmentType: 'full_time',
      teamMemberRef: 'PAY-42',
      notes: 'private note',
      acceptsBookings: false,
      headline: 'Senior stylist',
      languages: ['English', 'Spanish'],
      socialLinks: { instagram: 'jane.doe' },
    });

    expect(result.success).toBe(true);
    // The practitioner insert (identified by the email field) carries the new
    // columns through to the DB layer.
    const insertCall = mockDb.values.mock.calls.find(
      (call) => !Array.isArray(call[0]) && call[0]?.email === 'jane@example.com'
    );
    expect(insertCall?.[0]).toEqual(
      expect.objectContaining({
        phoneSecondary: '+353111222',
        phoneCountry: 'IE',
        country: 'ie',
        dateOfBirth: '1990-05-01',
        employmentStartDate: '2024-01-01',
        employmentEndDate: '2025-01-01',
        employmentType: 'full_time',
        teamMemberRef: 'PAY-42',
        notes: 'private note',
        acceptsBookings: false,
        headline: 'Senior stylist',
        languages: ['English', 'Spanish'],
        socialLinks: { instagram: 'jane.doe' },
      })
    );
  });

  it('derives `name` from first/last name when name is omitted', async () => {
    mockDb.where.mockResolvedValueOnce([]); // pickUnusedColor
    mockDb.returning.mockResolvedValueOnce([mockPractitioner]);

    const result = await createPractitioner(mockDb as never, {
      organizationId: ORG_ID,
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
    });

    expect(result.success).toBe(true);
    const insertCall = mockDb.values.mock.calls.find(
      (call) => !Array.isArray(call[0]) && call[0]?.email === 'jane@example.com'
    );
    expect(insertCall?.[0]?.name).toBe('Jane Doe');
  });

  it('returns VALIDATION_ERROR when neither name nor first/last provided', async () => {
    await expectResult(
      createPractitioner(mockDb as never, {
        organizationId: ORG_ID,
        email: 'jane@example.com',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for an invalid employmentType', async () => {
    await expectResult(
      createPractitioner(mockDb as never, {
        ...validInput,
        employmentType: 'freelance' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for an invalid country', async () => {
    await expectResult(
      createPractitioner(mockDb as never, {
        ...validInput,
        country: 'XX' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('seeds weekly shifts mirroring the org business hours', async () => {
    mockDb.where.mockResolvedValueOnce([]); // pickUnusedColor
    mockDb.returning.mockResolvedValueOnce([mockPractitioner]);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      businessHours: {
        0: { from: 0, to: 0 }, // closed
        1: { from: 600, to: 900 }, // Mon 10:00–15:00
        6: { from: 480, to: 720 }, // Sat 08:00–12:00
      },
    });

    const result = await createPractitioner(mockDb as never, validInput);

    expect(result.success).toBe(true);
    // Weekly shift rows inserted only for the two open days (closed day skipped).
    const shiftInsert = mockDb.values.mock.calls.find(
      (call) => Array.isArray(call[0]) && call[0][0]?.dayOfWeek !== undefined
    );
    expect(shiftInsert?.[0]).toEqual([
      expect.objectContaining({
        dayOfWeek: 1,
        startMinutes: 600,
        endMinutes: 900,
        isOff: false,
      }),
      expect.objectContaining({
        dayOfWeek: 6,
        startMinutes: 480,
        endMinutes: 720,
        isOff: false,
      }),
    ]);
  });

  it('falls back to a 9–5 Mon–Fri week when the org has no open hours', async () => {
    mockDb.where.mockResolvedValueOnce([]); // pickUnusedColor
    mockDb.returning.mockResolvedValueOnce([mockPractitioner]);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      businessHours: null,
    });

    const result = await createPractitioner(mockDb as never, validInput);

    expect(result.success).toBe(true);
    const shiftInsert = mockDb.values.mock.calls.find(
      (call) => Array.isArray(call[0]) && call[0][0]?.dayOfWeek !== undefined
    );
    expect(shiftInsert?.[0]).toHaveLength(5); // Mon–Fri
    for (const row of shiftInsert?.[0] ?? []) {
      expect(row.startMinutes).toBe(540); // 09:00
      expect(row.endMinutes).toBe(1020); // 17:00
      expect(row.dayOfWeek).toBeGreaterThanOrEqual(1);
      expect(row.dayOfWeek).toBeLessThanOrEqual(5);
    }
  });

  it('returns VALIDATION_ERROR for missing name', async () => {
    await expectResult(
      createPractitioner(mockDb as never, {
        ...validInput,
        name: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for invalid email', async () => {
    await expectResult(
      createPractitioner(mockDb as never, {
        ...validInput,
        email: 'not-an-email',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      createPractitioner(mockDb as never, {
        ...validInput,
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  // Shaped like what drizzle ACTUALLY throws: the wrapper's own message is
  // only "Failed query: …" and the constraint name lives on `cause`. The
  // previous version of this test threw a bare
  // `new Error('practitioner_org_email_unique')`, which the old
  // `error.message.includes(…)` check passed while prod — where the message is
  // the wrapper's — fell through to INTERNAL_ERROR and 500'd every "Add team
  // member" with a duplicate email (ENG-721).
  it('returns ALREADY_EXISTS for duplicate email in org', async () => {
    mockDb.where.mockResolvedValueOnce([]);
    mockDb.returning.mockRejectedValueOnce(
      drizzleUniqueViolation('practitioner_org_email_unique')
    );

    await expectResult(
      createPractitioner(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });

  it('returns INTERNAL_ERROR on unexpected DB failure', async () => {
    mockDb.where.mockResolvedValueOnce([]);
    mockDb.returning.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expectResult(
      createPractitioner(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
