import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

// `@borradh-workspace/database`, `@borradh-workspace/observability`,
// `@borradh-workspace/env/api` and `drizzle-orm` are aliased to canonical shared
// mocks in vite.config.ts — never vi.mock them here (a file-local mock leaks
// across files under `isolate:false`). Canonical provides `withOrgScope`
// (passthrough), the real `assistantWhatsappLink` table object, `trackedResult`
// (passthrough), `logError` (vi.fn), real drizzle operators, and
// `apiEnv.CLAIRE_WHATSAPP_NUMBER = '14155551234'` (matching the waLink assertion).

import { ErrorCodes } from '../../../shared/index.js';
import { startWhatsappLink } from './start-whatsapp-link.service.js';

const makeDb = () => {
  const returning = vi.fn().mockResolvedValue([{ id: 'link-1' }]);
  const insertValues = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values: insertValues }));
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const del = vi.fn(() => ({ where: deleteWhere }));
  return {
    insert,
    delete: del,
    _returning: returning,
    _deleteWhere: deleteWhere,
  };
};

const validInput = { userId: 'user-1', organizationId: 'org-1' };

describe('startWhatsappLink', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a pending link and returns code + wa.me link', async () => {
    const db = makeDb();
    const result = await startWhatsappLink(db as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('link-1');
      expect(result.data.code).toMatch(/^\d{6}$/);
      expect(result.data.waLink).toBe(
        `https://wa.me/14155551234?text=${encodeURIComponent(
          `Connect me to Claire — code ${result.data.code}`
        )}`
      );
      expect(result.data.codeExpiresAt.getTime()).toBeGreaterThan(Date.now());
    }
    // Pending rows cleared before insert.
    expect(db.delete).toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing userId', async () => {
    const db = makeDb();
    const result = await startWhatsappLink(db as never, {
      userId: '',
      organizationId: 'org-1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    const db = makeDb();
    db._returning.mockRejectedValueOnce(new Error('DB down'));
    const result = await startWhatsappLink(db as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
