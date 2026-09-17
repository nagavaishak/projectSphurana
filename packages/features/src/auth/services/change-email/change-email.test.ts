import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import type { ChangeEmailAuthApi } from './change-email.service.js';
import { changeEmail } from './change-email.service.js';

const createMockResponse = (ok: boolean, data: unknown, status = 200) => ({
  ok,
  status,
  json: vi.fn().mockResolvedValue(data),
  headers: {
    get: vi.fn(() => null),
  },
});

describe('changeEmail', () => {
  let mockAuthApi: ChangeEmailAuthApi;
  const sessionToken = 'valid-session-token';

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthApi = {
      changeEmail: vi.fn(),
    } as unknown as ChangeEmailAuthApi;
  });

  it('should send verification email for valid new email', async () => {
    const input = { newEmail: 'new@example.com' };

    const mockResponse = createMockResponse(true, { status: true }, 200);
    vi.mocked(mockAuthApi.changeEmail).mockResolvedValueOnce(
      mockResponse as never
    );

    const result = await changeEmail(mockAuthApi, input, sessionToken);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
      expect(result.data.message).toContain('Verification email sent');
    }
  });

  it('should return VALIDATION_ERROR for invalid email format', async () => {
    const result = await changeEmail(
      mockAuthApi,
      { newEmail: 'not-an-email' },
      sessionToken
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.changeEmail).not.toHaveBeenCalled();
  });

  it('should return UNAUTHORIZED for 401 response', async () => {
    const mockResponse = createMockResponse(
      false,
      { message: 'Unauthorized' },
      401
    );

    vi.mocked(mockAuthApi.changeEmail).mockResolvedValueOnce(
      mockResponse as never
    );

    const result = await changeEmail(
      mockAuthApi,
      { newEmail: 'new@example.com' },
      sessionToken
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    }
  });

  it('should return ALREADY_EXISTS when email is already in use', async () => {
    const mockResponse = createMockResponse(
      false,
      { message: 'Email already in use' },
      400
    );

    vi.mocked(mockAuthApi.changeEmail).mockResolvedValueOnce(
      mockResponse as never
    );

    const result = await changeEmail(
      mockAuthApi,
      { newEmail: 'existing@example.com' },
      sessionToken
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.ALREADY_EXISTS);
    }
  });

  it('should return ALREADY_EXISTS when exception contains "already"', async () => {
    vi.mocked(mockAuthApi.changeEmail).mockRejectedValueOnce(
      new Error('Email already exists')
    );

    const result = await changeEmail(
      mockAuthApi,
      { newEmail: 'taken@example.com' },
      sessionToken
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.ALREADY_EXISTS);
    }
  });

  it('should return INTERNAL_ERROR on unexpected exception', async () => {
    vi.mocked(mockAuthApi.changeEmail).mockRejectedValueOnce(
      new Error('Network failure')
    );

    const result = await changeEmail(
      mockAuthApi,
      { newEmail: 'new@example.com' },
      sessionToken
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
