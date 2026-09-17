import { describe, expect, it } from 'vitest';
import { isTransientDbError, withDbRetry } from './retry.js';

describe('isTransientDbError', () => {
  it('classifies postgres.js severed-socket null write as transient', () => {
    // The exact error postgres.js throws from connection.js `nextWrite` when a
    // query is dispatched onto a connection whose socket was already torn down
    // (Fly NAT severing an idle pooled connection). It carries no `code`.
    const error = new TypeError(
      "Cannot read properties of null (reading 'write')"
    );
    expect(isTransientDbError(error)).toBe(true);
  });

  it('detects the severed-socket error when wrapped on `cause`', () => {
    const wrapped = new Error('Failed query: update "meta_ad" ...');
    (wrapped as { cause?: unknown }).cause = new TypeError(
      "Cannot read properties of null (reading 'write')"
    );
    expect(isTransientDbError(wrapped)).toBe(true);
  });

  it('still treats application errors as non-transient', () => {
    expect(isTransientDbError(new Error('duplicate key value'))).toBe(false);
    expect(
      isTransientDbError(
        new TypeError("Cannot read properties of null (reading 'id')")
      )
    ).toBe(false);
  });
});

describe('withDbRetry', () => {
  it('retries the severed-socket error then succeeds', async () => {
    let attempts = 0;
    const result = await withDbRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError(
            "Cannot read properties of null (reading 'write')"
          );
        }
        return 'ok';
      },
      { retries: 2, minDelayMs: 1, maxDelayMs: 2 }
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('does not retry a non-transient error', async () => {
    let attempts = 0;
    await expect(
      withDbRetry(
        async () => {
          attempts += 1;
          throw new Error('duplicate key value');
        },
        { retries: 3, minDelayMs: 1, maxDelayMs: 2 }
      )
    ).rejects.toThrow('duplicate key value');
    expect(attempts).toBe(1);
  });
});
