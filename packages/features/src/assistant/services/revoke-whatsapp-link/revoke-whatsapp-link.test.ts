import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

// `@borradh-workspace/database`, `@borradh-workspace/observability` and
// `drizzle-orm` are aliased to canonical shared mocks in vite.config.ts — never
// vi.mock them here (a file-local mock leaks across files under `isolate:false`).
// Canonical provides `withOrgScope` (passthrough), the real `assistantWhatsappLink`
// table object, `trackedResult` (passthrough), `logError` (vi.fn) and real drizzle
// operators.

import { ErrorCodes } from '../../../shared/index.js';
import { revokeWhatsappLink } from './revoke-whatsapp-link.service.js';

const makeDb = (returningRows: { id: string }[]) => {
  const returning = vi.fn().mockResolvedValue(returningRows);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return { update, _returning: returning };
};

const validInput = { id: 'link-1', userId: 'user-1' };

describe('revokeWhatsappLink', () => {
  beforeEach(() => vi.clearAllMocks());

  it('revokes an owned link', async () => {
    const db = makeDb([{ id: 'link-1' }]);
    const result = await revokeWhatsappLink(db as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('link-1');
    }
    expect(db.update).toHaveBeenCalled();
  });

  it('returns NOT_FOUND when no owned row matches', async () => {
    const db = makeDb([]);
    const result = await revokeWhatsappLink(db as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns VALIDATION_ERROR for missing id', async () => {
    const db = makeDb([]);
    const result = await revokeWhatsappLink(db as never, {
      id: '',
      userId: 'user-1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(db.update).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    const db = makeDb([]);
    db._returning.mockRejectedValueOnce(new Error('DB down'));
    const result = await revokeWhatsappLink(db as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
