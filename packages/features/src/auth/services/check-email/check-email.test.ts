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
import { checkEmail } from './check-email.service.js';

describe('checkEmail', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    email: 'test@example.com',
  };

  const existingUser = {
    id: 'user_123',
    email: 'test@example.com',
    name: 'Test User',
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('should return exists=false when user is not found', async () => {
    mockDb.query.user.findFirst.mockResolvedValueOnce(null);

    const result = await checkEmail(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.exists).toBe(false);
      expect(result.data.hasPassword).toBe(false);
      expect(result.data.providers).toEqual([]);
    }
  });

  it('should return exists=true with hasPassword=true when user has credential account with password', async () => {
    const accounts = [
      { providerId: 'credential', password: 'hashed_password_123' },
    ];

    mockDb.query.user.findFirst.mockResolvedValueOnce(existingUser);
    mockDb.where.mockResolvedValueOnce(accounts);

    const result = await checkEmail(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.exists).toBe(true);
      expect(result.data.hasPassword).toBe(true);
      expect(result.data.providers).toEqual([]);
    }
  });

  it('should return OAuth providers when user has both credential and OAuth accounts', async () => {
    const accounts = [
      { providerId: 'credential', password: 'hashed_password' },
      { providerId: 'google', password: null },
    ];

    mockDb.query.user.findFirst.mockResolvedValueOnce(existingUser);
    mockDb.where.mockResolvedValueOnce(accounts);

    const result = await checkEmail(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.exists).toBe(true);
      expect(result.data.hasPassword).toBe(true);
      expect(result.data.providers).toEqual(['google']);
    }
  });

  it('should return hasPassword=false when credential account has no password', async () => {
    const accounts = [{ providerId: 'credential', password: null }];

    mockDb.query.user.findFirst.mockResolvedValueOnce(existingUser);
    mockDb.where.mockResolvedValueOnce(accounts);

    const result = await checkEmail(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.exists).toBe(true);
      expect(result.data.hasPassword).toBe(false);
      expect(result.data.providers).toEqual([]);
    }
  });

  it('should return hasPassword=false when user only has OAuth accounts', async () => {
    const accounts = [{ providerId: 'google', password: null }];

    mockDb.query.user.findFirst.mockResolvedValueOnce(existingUser);
    mockDb.where.mockResolvedValueOnce(accounts);

    const result = await checkEmail(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.exists).toBe(true);
      expect(result.data.hasPassword).toBe(false);
      expect(result.data.providers).toEqual(['google']);
    }
  });

  it('should return multiple OAuth providers', async () => {
    const accounts = [
      { providerId: 'google', password: null },
      { providerId: 'apple', password: null },
    ];

    mockDb.query.user.findFirst.mockResolvedValueOnce(existingUser);
    mockDb.where.mockResolvedValueOnce(accounts);

    const result = await checkEmail(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.exists).toBe(true);
      expect(result.data.hasPassword).toBe(false);
      expect(result.data.providers).toEqual(['google', 'apple']);
    }
  });

  it('should return VALIDATION_ERROR for invalid email', async () => {
    const invalidInput = { email: 'not-an-email' };

    await expectResult(
      checkEmail(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.user.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing email', async () => {
    const invalidInput = {};

    await expectResult(
      checkEmail(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.user.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty email', async () => {
    const invalidInput = { email: '' };

    await expectResult(
      checkEmail(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.user.findFirst).not.toHaveBeenCalled();
  });

  it('should lowercase the email before querying', async () => {
    const uppercaseInput = { email: 'Test@Example.COM' };

    mockDb.query.user.findFirst.mockResolvedValueOnce(null);

    const result = await checkEmail(mockDb as never, uppercaseInput);

    expect(result.success).toBe(true);
    expect(mockDb.query.user.findFirst).toHaveBeenCalled();
  });
});
