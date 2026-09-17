import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

// `@borradh-workspace/database`, `@borradh-workspace/observability` and
// `drizzle-orm` are aliased to canonical shared mocks in vite.config.ts — never
// vi.mock them here (a file-local mock leaks across files under `isolate:false`).
// Canonical provides `withOrgScope` (passthrough), the real `assistantWhatsappLink`
// table object, `trackedResult` (passthrough), `logError` (vi.fn) and real drizzle
// operators.

import { ErrorCodes } from '../../../shared/index.js';
import { getWhatsappLinkStatus } from './get-whatsapp-link-status.service.js';

const makeDb = () => {
  const findFirst = vi.fn();
  return {
    query: { assistantWhatsappLink: { findFirst } },
    _findFirst: findFirst,
  };
};

const validInput = { userId: 'user-1', organizationId: 'org-1' };

describe('getWhatsappLinkStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the active link when present', async () => {
    const db = makeDb();
    const row = {
      id: 'link-1',
      status: 'active',
      phoneE164: '353871234567',
      verifiedAt: new Date(),
      createdAt: new Date(),
    };
    db._findFirst.mockResolvedValueOnce(row);
    const result = await getWhatsappLinkStatus(db as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.link?.id).toBe('link-1');
      expect(result.data.link?.status).toBe('active');
    }
  });

  it('returns null link when none exists', async () => {
    const db = makeDb();
    db._findFirst.mockResolvedValueOnce(undefined);
    const result = await getWhatsappLinkStatus(db as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.link).toBeNull();
    }
  });

  it('returns VALIDATION_ERROR for missing org', async () => {
    const db = makeDb();
    const result = await getWhatsappLinkStatus(db as never, {
      userId: 'user-1',
      organizationId: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(db._findFirst).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    const db = makeDb();
    db._findFirst.mockRejectedValueOnce(new Error('DB down'));
    const result = await getWhatsappLinkStatus(db as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
