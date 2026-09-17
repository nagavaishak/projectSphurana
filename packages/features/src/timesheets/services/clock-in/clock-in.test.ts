import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { clockIn } from './clock-in.service.js';

describe('clockIn', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    practitionerId: 'prac_123',
  };

  const mockPractitioner = { id: 'prac_123', organizationId: 'org_123' };

  it('creates an open time entry with valid input', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(mockPractitioner);
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(null);
    const mockEntry = {
      id: 'te_1',
      organizationId: 'org_123',
      practitionerId: 'prac_123',
      status: 'open',
    };
    mockDb.returning.mockResolvedValueOnce([mockEntry]);

    const result = await clockIn(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(mockEntry);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('uses the provided clock-in time and source', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(mockPractitioner);
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([{ id: 'te_1' }]);

    const at = new Date('2026-07-06T09:00:00Z');
    await clockIn(mockDb as never, { ...validInput, at, source: 'auto' });

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ clockIn: at, source: 'auto', status: 'open' })
    );
  });

  it('returns VALIDATION_ERROR for missing practitionerId', async () => {
    const result = await clockIn(mockDb as never, {
      organizationId: 'org_123',
      practitionerId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for a clock-in time in the future', async () => {
    const result = await clockIn(mockDb as never, {
      ...validInput,
      at: new Date(Date.now() + 60 * 60 * 1000), // 1 hour ahead
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when practitioner does not exist in org', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(null);

    const result = await clockIn(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns CONFLICT when an open entry already exists', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(mockPractitioner);
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce({
      id: 'te_open',
      clockOut: null,
    });

    const result = await clockIn(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('forbids clocking in another practitioner for a non-manager caller', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      ...mockPractitioner,
      userId: 'user_owner',
    });

    const result = await clockIn(mockDb as never, {
      ...validInput,
      requestingUserId: 'user_someone_else',
      canManageOthers: false,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.FORBIDDEN);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('allows a non-manager to clock in their own linked practitioner', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      ...mockPractitioner,
      userId: 'user_self',
    });
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([{ id: 'te_1' }]);

    const result = await clockIn(mockDb as never, {
      ...validInput,
      requestingUserId: 'user_self',
      canManageOthers: false,
    });

    expect(result.success).toBe(true);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('allows a manager to clock in another practitioner', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      ...mockPractitioner,
      userId: 'user_owner',
    });
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([{ id: 'te_1' }]);

    const result = await clockIn(mockDb as never, {
      ...validInput,
      requestingUserId: 'user_manager',
      canManageOthers: true,
    });

    expect(result.success).toBe(true);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(mockPractitioner);
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    const result = await clockIn(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
