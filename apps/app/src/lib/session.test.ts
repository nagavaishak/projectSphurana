import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `GET auth/session` answers 200 `{ user: null }` when signed out — it never
 * errors for that. So a thrown error is always transport/server failure, and
 * reporting it as "signed out" is how one slow response used to log a user out
 * and bounce them off a protected route (504s from an overloaded preview API
 * took whole e2e suites down on the sign-in page).
 */

const h = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: { get: h.get },
}));

import { queryClient } from '@/lib/query-client';
import { ensureSession } from './session';

const SESSION = {
  user: { id: 'u1', email: 'a@b.com' },
  session: { id: 's1' },
};

describe('ensureSession', () => {
  beforeEach(() => {
    h.get.mockReset();
    queryClient.clear();
  });

  it('recovers from a transient failure instead of reporting a sign-out', async () => {
    h.get
      .mockRejectedValueOnce(new Error('504 Gateway Timeout'))
      .mockResolvedValueOnce(SESSION);

    const result = await ensureSession();

    expect(result.user?.id).toBe('u1');
    expect(result.unavailable).toBeFalsy();
    expect(h.get).toHaveBeenCalledTimes(2);
  });

  it('reports `unavailable` — not a signed-out session — when it never resolves', async () => {
    h.get.mockRejectedValue(new Error('504 Gateway Timeout'));

    const result = await ensureSession();

    expect(result.unavailable).toBe(true);
    expect(result.user).toBeNull();
    // Retried, rather than giving up on the first failure.
    expect(h.get.mock.calls.length).toBeGreaterThan(1);
  });

  it('passes through a real signed-out response (200 with user: null)', async () => {
    h.get.mockResolvedValueOnce({ user: null, session: null });

    const result = await ensureSession();

    expect(result.user).toBeNull();
    // No `unavailable` — the server positively said "signed out", so callers
    // SHOULD redirect to /sign-in here.
    expect(result.unavailable).toBeFalsy();
    expect(h.get).toHaveBeenCalledTimes(1);
  });
});
