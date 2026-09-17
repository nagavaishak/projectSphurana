import {
  beforeEach,
  createMockDatabase,
  createTestUser,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { createUser } from './create-user.service.js';

describe('createUser', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // Reset returning mock properly (mockClear doesn't clear mockResolvedValueOnce queue)
    mockDb.returning.mockReset();
    mockDb.returning.mockResolvedValue([]);
  });

  it('should create a user with valid input', async () => {
    const input = {
      email: 'test@example.com',
      name: 'Test User',
    };

    const mockUser = createTestUser({
      email: input.email,
      name: input.name,
    });

    // Mock: no existing user found
    mockDb.query.user.findFirst.mockResolvedValueOnce(null);
    // Mock: insert returns the created user
    mockDb.returning.mockResolvedValueOnce([mockUser]);

    const result = await createUser(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe(input.email);
      expect(result.data.name).toBe(input.name);
    }

    expect(mockDb.insert).toHaveBeenCalled();
    // Service adds 'id' field, so use objectContaining for partial match
    expect(mockDb.values).toHaveBeenCalledWith(expect.objectContaining(input));
  });

  it('should return VALIDATION_ERROR for invalid email', async () => {
    const input = {
      email: 'invalid-email',
      name: 'Test User',
    };

    await expectResult(createUser(mockDb as never, input)).toFailWithCode(
      ErrorCodes.VALIDATION_ERROR
    );

    // Should not attempt to insert
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty email', async () => {
    const input = {
      email: '',
      name: 'Test User',
    };

    await expectResult(createUser(mockDb as never, input)).toFailWithCode(
      ErrorCodes.VALIDATION_ERROR
    );
  });

  it('should return VALIDATION_ERROR for name too short', async () => {
    const input = {
      email: 'test@example.com',
      name: 'A', // Too short (assuming min length validation)
    };

    await expectResult(createUser(mockDb as never, input)).toFailWithCode(
      ErrorCodes.VALIDATION_ERROR
    );
  });

  it('should return ALREADY_EXISTS if user email exists', async () => {
    const input = {
      email: 'existing@example.com',
      name: 'Test User',
    };

    const existingUser = createTestUser({ email: input.email });

    // Mock: existing user found
    mockDb.query.user.findFirst.mockResolvedValueOnce(existingUser);

    await expectResult(createUser(mockDb as never, input)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.ALREADY_EXISTS);
        expect(error.message).toContain(input.email);
      }
    );

    // Should not attempt to insert
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should handle database errors gracefully', async () => {
    const input = {
      email: 'test@example.com',
      name: 'Test User',
    };

    // Mock: no existing user
    mockDb.query.user.findFirst.mockResolvedValueOnce(null);
    // Mock: database error on insert
    mockDb.returning.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(createUser(mockDb as never, input)).rejects.toThrow(
      'Database connection failed'
    );
  });

  it('should create a user with optional organizationId', async () => {
    const input = {
      email: 'withorg@example.com',
      name: 'Org User',
      organizationId: '550e8400-e29b-41d4-a716-446655440000',
    };

    const mockUser = createTestUser({
      email: input.email,
      name: input.name,
    });

    mockDb.query.user.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([mockUser]);

    await expectResult(createUser(mockDb as never, input)).toSucceedWith(
      (data) => {
        expect(data.email).toBe(input.email);
      }
    );
  });
});
