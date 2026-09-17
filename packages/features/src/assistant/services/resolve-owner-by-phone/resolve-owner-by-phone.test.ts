import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

// `@borradh-workspace/database`, `@borradh-workspace/observability` and
// `drizzle-orm` are aliased to canonical shared mocks in vite.config.ts — never
// vi.mock them here (a file-local mock leaks across files under `isolate:false`).
// Canonical provides `withSystemScope` (passthrough), the real `assistantWhatsappLink`
// table object, `trackedResult` (passthrough), `logError` (vi.fn) and real drizzle
// operators.

import { ErrorCodes } from '../../../shared/index.js';
import { resolveOwnerByPhone } from './resolve-owner-by-phone.service.js';

const makeDb = () => {
  const findFirst = vi.fn();
  return {
    query: { assistantWhatsappLink: { findFirst } },
    _findFirst: findFirst,
  };
};

describe('resolveOwnerByPhone', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns owner when an active link exists', async () => {
    const db = makeDb();
    db._findFirst.mockResolvedValueOnce({
      userId: 'user-1',
      organizationId: 'org-1',
    });
    const result = await resolveOwnerByPhone(db as never, '353871234567');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        userId: 'user-1',
        organizationId: 'org-1',
      });
    }
  });

  it('returns null when the number is not paired', async () => {
    const db = makeDb();
    db._findFirst.mockResolvedValueOnce(null);
    const result = await resolveOwnerByPhone(db as never, '353871234567');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it('returns VALIDATION_ERROR for empty phone', async () => {
    const db = makeDb();
    const result = await resolveOwnerByPhone(db as never, '');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(db._findFirst).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    const db = makeDb();
    db._findFirst.mockRejectedValueOnce(new Error('DB down'));
    const result = await resolveOwnerByPhone(db as never, '353871234567');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
