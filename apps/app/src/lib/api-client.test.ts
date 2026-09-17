import { describe, expect, it } from 'vitest';

import {
  INVALID_SESSION_MESSAGE,
  isInvalidSessionError,
} from './session-lifecycle';

describe('isInvalidSessionError', () => {
  it('recognises the API response produced when Better Auth rejects a bearer', () => {
    expect(
      isInvalidSessionError({
        status: 401,
        message: INVALID_SESSION_MESSAGE,
      })
    ).toBe(true);
  });

  it('does not sign a user out for unrelated authorization failures', () => {
    expect(
      isInvalidSessionError({
        status: 401,
        message: 'Email verification required',
      })
    ).toBe(false);
    expect(
      isInvalidSessionError({
        status: 403,
        message: INVALID_SESSION_MESSAGE,
      })
    ).toBe(false);
  });
});
