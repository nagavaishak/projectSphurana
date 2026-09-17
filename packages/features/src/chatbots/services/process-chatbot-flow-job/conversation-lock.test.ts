import { getRedis } from '@borradh-workspace/redis';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { acquireConversationLock } from './conversation-lock.js';

const mockSet = vi.mocked(getRedis)().set;
const mockEval = vi.mocked(getRedis)().eval;

describe('acquireConversationLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns acquired: true when SET NX succeeds', async () => {
    mockSet.mockResolvedValueOnce('OK');

    const lock = await acquireConversationLock('conv-123');

    expect(lock.acquired).toBe(true);
    expect(mockSet).toHaveBeenCalledWith(
      'conversation-lock:conv-123',
      expect.any(String),
      'PX',
      180000,
      'NX'
    );
  });

  it('returns acquired: false when SET NX fails', async () => {
    mockSet.mockResolvedValueOnce(null);

    const lock = await acquireConversationLock('conv-123');

    expect(lock.acquired).toBe(false);
  });

  it('release calls Redis eval with Lua script', async () => {
    mockSet.mockResolvedValueOnce('OK');
    mockEval.mockResolvedValueOnce(1);

    const lock = await acquireConversationLock('conv-123');
    await lock.release();

    expect(mockEval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("get", KEYS[1])'),
      1,
      'conversation-lock:conv-123',
      expect.any(String)
    );
  });

  it('release is a no-op when lock was not acquired', async () => {
    mockSet.mockResolvedValueOnce(null);

    const lock = await acquireConversationLock('conv-123');
    await lock.release();

    expect(mockEval).not.toHaveBeenCalled();
  });

  it('uses correct lock key format', async () => {
    mockSet.mockResolvedValueOnce('OK');

    await acquireConversationLock('my-conv-id');

    expect(mockSet).toHaveBeenCalledWith(
      'conversation-lock:my-conv-id',
      expect.any(String),
      'PX',
      180000,
      'NX'
    );
  });

  it('uses default TTL of 180000ms', async () => {
    mockSet.mockResolvedValueOnce('OK');

    await acquireConversationLock('conv-1');

    expect(mockSet).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'PX',
      180000,
      'NX'
    );
  });

  it('passes custom TTL to SET', async () => {
    mockSet.mockResolvedValueOnce('OK');

    await acquireConversationLock('conv-1', 30000);

    expect(mockSet).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'PX',
      30000,
      'NX'
    );
  });
});
