import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

// `@borradh-workspace/database`, `@borradh-workspace/observability` and
// `drizzle-orm` are aliased to canonical shared mocks in vite.config.ts — never
// vi.mock them here (a file-local mock leaks across files under `isolate:false`).
// Canonical provides `withSystemScope` (passthrough), the real `assistantWhatsappLink`
// table object, `trackedResult` (passthrough), `logError` (vi.fn) and real drizzle
// operators.

import { ErrorCodes } from '../../../shared/index.js';
import { verifyWhatsappLink } from './verify-whatsapp-link.service.js';

const futureDate = () => new Date(Date.now() + 5 * 60 * 1000);
const pastDate = () => new Date(Date.now() - 60 * 1000);

const makeDb = () => {
  const findFirst = vi.fn();
  const returning = vi
    .fn()
    .mockResolvedValue([
      { id: 'link-1', userId: 'user-1', organizationId: 'org-1' },
    ]);
  const updateWhere = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));
  // Audit trail insert (logAuditEvent on successful pairing).
  const auditValues = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values: auditValues }));
  return {
    query: { assistantWhatsappLink: { findFirst } },
    update,
    insert,
    _findFirst: findFirst,
    _returning: returning,
    _auditValues: auditValues,
  };
};

const validInput = { code: '123456', fromPhoneE164: '353871234567' };

describe('verifyWhatsappLink', () => {
  beforeEach(() => vi.clearAllMocks());

  it('activates a pending non-expired link and stamps the phone', async () => {
    const db = makeDb();
    db._findFirst
      .mockResolvedValueOnce({ id: 'link-1', codeExpiresAt: futureDate() }) // pending lookup
      .mockResolvedValueOnce(null); // no existing active for phone

    const result = await verifyWhatsappLink(db as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userId).toBe('user-1');
      expect(result.data.organizationId).toBe('org-1');
      expect(result.data.phoneE164).toBe('353871234567');
    }
    expect(db.update).toHaveBeenCalled();
    // Writes a durable audit row for the successful pairing.
    expect(db.insert).toHaveBeenCalled();
    expect(db._auditValues).toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when code not found', async () => {
    const db = makeDb();
    db._findFirst.mockResolvedValueOnce(null);
    const result = await verifyWhatsappLink(db as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(db.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when code expired', async () => {
    const db = makeDb();
    db._findFirst.mockResolvedValueOnce({
      id: 'link-1',
      codeExpiresAt: pastDate(),
    });
    const result = await verifyWhatsappLink(db as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns CONFLICT when phone already linked to another active row', async () => {
    const db = makeDb();
    db._findFirst
      .mockResolvedValueOnce({ id: 'link-1', codeExpiresAt: futureDate() })
      .mockResolvedValueOnce({ id: 'other-active' });
    const result = await verifyWhatsappLink(db as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    }
    expect(db.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing code', async () => {
    const db = makeDb();
    const result = await verifyWhatsappLink(db as never, {
      code: '',
      fromPhoneE164: '353871234567',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    const db = makeDb();
    db._findFirst.mockRejectedValueOnce(new Error('DB down'));
    const result = await verifyWhatsappLink(db as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
