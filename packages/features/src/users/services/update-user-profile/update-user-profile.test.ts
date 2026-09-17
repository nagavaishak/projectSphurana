import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { updateUserProfile } from './update-user-profile.service.js';

/**
 * These exercise the real `updateUser` + `clearSessionSecondaryStorageForUser`
 * against a stubbed db/redis rather than module mocks — the features suite runs
 * with `isolate: false`, where `vi.mock` of an already-loaded module leaks into
 * sibling files.
 */
const existingUser = {
  id: 'user-1',
  name: 'Old Name',
  email: 'user@example.com',
  emailVerified: true,
  image: null,
  currency: 'EUR',
  timezone: 'Europe/Dublin',
  role: 'user',
  banned: false,
  banReason: null,
  banExpires: null,
  twoFactorEnabled: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function createMockDb(overrides: { existing?: unknown } = {}) {
  const updated = { ...existingUser, name: 'New Name' };

  const returning = vi.fn().mockResolvedValue([updated]);
  const whereUpdate = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where: whereUpdate }));
  const update = vi.fn(() => ({ set }));

  // `clearSessionSecondaryStorageForUser` lists this user's session tokens.
  const whereSelect = vi.fn().mockResolvedValue([{ token: 'tok-1' }]);
  const from = vi.fn(() => ({ where: whereSelect }));
  const select = vi.fn(() => ({ from }));

  // First read = `updateUser`'s existence check (pre-update row); every later
  // read is `getUser` inside the cache refresh, which sees the saved row.
  const findFirst = vi
    .fn()
    .mockResolvedValueOnce(
      'existing' in overrides ? overrides.existing : existingUser
    )
    .mockResolvedValue(updated);

  return {
    db: {
      query: { user: { findFirst } },
      update,
      select,
    },
    updated,
    update,
    findFirst,
    select,
  };
}

describe('updateUserProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves the profile and returns the updated user', async () => {
    const { db, updated } = createMockDb();

    const result = await updateUserProfile(db as never, {
      id: 'user-1',
      name: 'New Name',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(updated);
    }
  });

  it('refreshes the cached session blob for the user', async () => {
    const { db } = createMockDb();
    const redis = {
      get: vi.fn(async (key: string) =>
        key === 'tok-1'
          ? JSON.stringify({ session: { id: 's1' }, user: { id: 'user-1' } })
          : null
      ),
      set: vi.fn().mockResolvedValue('OK'),
      ttl: vi.fn().mockResolvedValue(120),
      del: vi.fn().mockResolvedValue(1),
    };

    const result = await updateUserProfile(
      db as never,
      { id: 'user-1', name: 'New Name' },
      redis
    );

    expect(result.success).toBe(true);
    expect(redis.set).toHaveBeenCalledTimes(1);
    const [, payload] = redis.set.mock.calls[0] as [string, string];
    expect(JSON.parse(payload).user.name).toBe('New Name');
  });

  it('still succeeds when the session-cache refresh fails', async () => {
    const { db } = createMockDb();
    const redis = {
      get: vi.fn().mockRejectedValue(new Error('redis down')),
      set: vi.fn(),
      ttl: vi.fn(),
      del: vi.fn(),
    };

    const result = await updateUserProfile(
      db as never,
      { id: 'user-1', name: 'New Name' },
      redis
    );

    expect(result.success).toBe(true);
  });

  it('returns VALIDATION_ERROR without writing when the id is empty', async () => {
    const { db, update } = createMockDb();

    const result = await updateUserProfile(db as never, {
      id: '',
      name: 'New Name',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the user does not exist', async () => {
    const { db, update } = createMockDb({ existing: undefined });

    const result = await updateUserProfile(db as never, {
      id: 'user-1',
      name: 'New Name',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
    expect(update).not.toHaveBeenCalled();
  });
});
