import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

// `@borradh-workspace/database`, `@borradh-workspace/observability` and
// `drizzle-orm` are aliased to canonical shared mocks in vite.config.ts — never
// vi.mock them here (a file-local mock leaks across files under `isolate:false`).
// The canonical database mock provides `withOrgScope` as a passthrough and the
// real `assistantConversation` table object; observability's `trackedResult` is
// a passthrough and `logError` a vi.fn(); real drizzle operators are used.

// `SKILL_REGISTRY_VERSION` used to be faked to 42 via a bare
// `vi.mock('../../skills/index.js')`. That factory both leaked onto the shared
// module graph and DELETED every other export of the skills barrel for later
// files. `vi.spyOn` cannot stand in — it's a plain const, not a function — so
// the real value is imported and asserted against instead, which is also
// drift-proof when the registry version bumps.
import { SKILL_REGISTRY_VERSION } from '../../skills/index.js';

import { ErrorCodes } from '../../../shared/index.js';
import { findOrCreateWhatsappConversation } from './find-or-create-whatsapp-conversation.service.js';

/**
 * Mock db supporting both the select().from().where().orderBy().limit() read
 * and the insert().values().returning() write.
 */
const makeDb = () => {
  const limit = vi.fn();
  const insertReturning = vi.fn();

  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit,
  };
  const select = vi.fn().mockReturnValue(selectChain);

  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: insertReturning,
  };
  const insert = vi.fn().mockReturnValue(insertChain);

  return {
    select,
    insert,
    _limit: limit,
    _insertReturning: insertReturning,
    _insertValues: insertChain.values,
  };
};

const input = {
  organizationId: 'org-1',
  userId: 'user-1',
  whatsappPhoneE164: '14155551234',
};

describe('findOrCreateWhatsappConversation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the existing whatsapp conversation when one exists', async () => {
    const db = makeDb();
    db._limit.mockResolvedValueOnce([
      {
        id: 'conv-existing',
        loadedSkillIds: ['default', 'campaigns'],
        pendingConfirmation: { kind: 'ad', draftId: 'draft-9' },
      },
    ]);

    const result = await findOrCreateWhatsappConversation(db as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('conv-existing');
      expect(result.data.isNew).toBe(false);
      expect(result.data.loadedSkillIds).toEqual(['default', 'campaigns']);
      expect(result.data.pendingConfirmation).toEqual({
        kind: 'ad',
        draftId: 'draft-9',
      });
    }
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('creates a new whatsapp conversation when none exists', async () => {
    const db = makeDb();
    db._limit.mockResolvedValueOnce([]);
    db._insertReturning.mockResolvedValueOnce([
      { id: 'conv-new', loadedSkillIds: [], pendingConfirmation: null },
    ]);

    const result = await findOrCreateWhatsappConversation(db as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('conv-new');
      expect(result.data.isNew).toBe(true);
      expect(result.data.loadedSkillIds).toEqual([]);
      expect(result.data.pendingConfirmation).toBeNull();
    }
    // Inserts on the whatsapp channel with the paired phone + pinned version.
    expect(db._insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        userId: 'user-1',
        channel: 'whatsapp',
        whatsappPhoneE164: '14155551234',
        skillRegistryVersion: SKILL_REGISTRY_VERSION,
      })
    );
  });

  it('returns VALIDATION_ERROR for missing phone', async () => {
    const db = makeDb();
    const result = await findOrCreateWhatsappConversation(db as never, {
      organizationId: 'org-1',
      userId: 'user-1',
      whatsappPhoneE164: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(db.select).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    const db = makeDb();
    db._limit.mockRejectedValueOnce(new Error('db down'));

    const result = await findOrCreateWhatsappConversation(db as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
