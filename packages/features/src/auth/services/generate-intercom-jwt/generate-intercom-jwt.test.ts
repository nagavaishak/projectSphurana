import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateIntercomJwt } from './generate-intercom-jwt.service.js';

/**
 * SPY, NOT `vi.mock('jsonwebtoken')`.
 *
 * This suite runs under `isolate: false`, so the module registry is shared
 * across test files. A factory mock only wins if this file happens to be the
 * first to pull `jsonwebtoken` in — and it stopped being first the moment
 * anything else imported the auth barrel early enough to load the real module.
 * Then `vi.mock` silently no-ops and the assertions compare against a genuine
 * signed JWT, which is exactly how this failed: green alone, red in the suite.
 *
 * Spying on the real module has no such ordering dependency: it patches
 * whichever instance is actually in play.
 */
const { logError } = await import('@borradh-workspace/observability');

const mockSign = vi.spyOn(jwt, 'sign');
const mockLogError = vi.mocked(logError);

describe('generateIntercomJwt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSign.mockReset();
  });

  afterEach(() => {
    mockSign.mockReset();
  });

  it('returns undefined when secret is undefined', () => {
    const result = generateIntercomJwt(undefined, {
      id: 'user-1',
      email: 'test@example.com',
    });

    expect(result).toBeUndefined();
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('returns undefined when secret is empty string', () => {
    const result = generateIntercomJwt('', {
      id: 'user-1',
      email: 'test@example.com',
    });

    expect(result).toBeUndefined();
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('returns a signed JWT when secret is configured', () => {
    mockSign.mockReturnValue('signed-jwt-token' as never);

    const result = generateIntercomJwt('my-secret', {
      id: 'user-1',
      email: 'test@example.com',
    });

    expect(result).toBe('signed-jwt-token');
    expect(mockSign).toHaveBeenCalledWith(
      { user_id: 'user-1', email: 'test@example.com' },
      'my-secret',
      { expiresIn: '1h' }
    );
  });

  it('returns undefined and logs error when jwt.sign throws', () => {
    mockSign.mockImplementation(() => {
      throw new Error('invalid secret format');
    });

    const result = generateIntercomJwt('bad-secret', {
      id: 'user-1',
      email: 'test@example.com',
    });

    expect(result).toBeUndefined();
    expect(mockLogError).toHaveBeenCalledWith(
      'auth.generateIntercomJwt',
      expect.any(Error),
      {
        feature: 'auth',
        extra: { userId: 'user-1' },
      }
    );
  });

  it('only includes user_id and email in the JWT payload', () => {
    mockSign.mockReturnValue('token' as never);

    generateIntercomJwt('secret', {
      id: 'user-1',
      email: 'test@example.com',
    });

    const payload = mockSign.mock.calls[0][0];
    expect(payload).toEqual({ user_id: 'user-1', email: 'test@example.com' });
  });
});
