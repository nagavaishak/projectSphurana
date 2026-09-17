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
import { importExternalTeamMembers } from './import-external-team-members.service.js';

describe('importExternalTeamMembers', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    bookingAccountId: 'ba_123',
    members: [
      {
        externalId: 'ext_1',
        name: 'Jane Doe',
        email: 'jane@example.com',
        selected: true,
      },
    ],
  };

  it('should create new practitioners for selected members', async () => {
    mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce({
      id: 'ba_123',
      organizationId: 'org_123',
      provider: 'calendly',
    });
    // No existing practitioner
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(null);

    const mockPractitioner = {
      id: 'prac_1',
      organizationId: 'org_123',
      name: 'Jane Doe',
      email: 'jane@example.com',
    };
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([mockPractitioner]);

    // Mock update for organization
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce(undefined);

    const result = await importExternalTeamMembers(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toHaveLength(1);
      expect(result.data.linked).toHaveLength(0);
      expect(result.data.skipped).toHaveLength(0);
    }
  });

  it('should link existing practitioners', async () => {
    mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce({
      id: 'ba_123',
      organizationId: 'org_123',
      provider: 'calendly',
    });
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: 'prac_existing',
      email: 'jane@example.com',
    });

    const mockUpdated = {
      id: 'prac_existing',
      email: 'jane@example.com',
      bookingAccountId: 'ba_123',
    };
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    // First where() call is in the practitioner update chain (needs to be chainable for .returning())
    mockDb.where.mockReturnValueOnce(mockDb);
    mockDb.returning.mockResolvedValueOnce([mockUpdated]);

    // Second where() call is for the organization update (terminal, no .returning())
    mockDb.where.mockResolvedValueOnce(undefined);

    const result = await importExternalTeamMembers(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toHaveLength(0);
      expect(result.data.linked).toHaveLength(1);
    }
  });

  it('should return empty results when no members selected', async () => {
    mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce({
      id: 'ba_123',
      organizationId: 'org_123',
      provider: 'calendly',
    });

    const input = {
      ...validInput,
      members: [
        {
          externalId: 'ext_1',
          name: 'Jane',
          email: 'jane@example.com',
          selected: false,
        },
      ],
    };

    const result = await importExternalTeamMembers(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toHaveLength(0);
      expect(result.data.linked).toHaveLength(0);
    }
  });

  it('should return NOT_FOUND when booking account not found', async () => {
    mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      importExternalTeamMembers(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for empty members array', async () => {
    await expectResult(
      importExternalTeamMembers(mockDb as never, {
        ...validInput,
        members: [],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid email', async () => {
    await expectResult(
      importExternalTeamMembers(mockDb as never, {
        ...validInput,
        members: [
          {
            externalId: 'ext_1',
            name: 'Jane',
            email: 'not-an-email',
            selected: true,
          },
        ],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce({
      id: 'ba_123',
      organizationId: 'org_123',
      provider: 'calendly',
    });
    mockDb.query.practitioner.findFirst.mockRejectedValueOnce(
      new Error('DB error')
    );

    await expectResult(
      importExternalTeamMembers(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
