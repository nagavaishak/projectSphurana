import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

// `@borradh-workspace/database`, `@borradh-workspace/observability` and
// `drizzle-orm` are aliased to canonical shared mocks in vite.config.ts — never
// vi.mock them here (a file-local mock leaks across files under `isolate:false`).
// Canonical provides `withOrgScope` (passthrough), the real `assistantConversation`
// table object, `trackedResult` (passthrough), `logError` (vi.fn) and real drizzle
// operators.

import { ErrorCodes } from '../../../shared/index.js';
import {
  clearPendingConfirmation,
  getPendingConfirmation,
  setPendingConfirmation,
} from './pending-confirmation.service.js';

/**
 * Mock db supporting both the update().set().where().returning() chain used
 * by set/clear and the query.assistantConversation.findFirst() read used by
 * get.
 */
const makeDb = () => {
  const returning = vi.fn();
  const findFirst = vi.fn();
  const set = vi.fn();
  const chain = {
    set,
    where: vi.fn().mockReturnThis(),
    returning,
  };
  set.mockReturnValue(chain);
  const update = vi.fn().mockReturnValue(chain);

  return {
    update,
    query: { assistantConversation: { findFirst } },
    _returning: returning,
    _findFirst: findFirst,
    _set: set,
  };
};

const locator = { conversationId: 'conv-1', organizationId: 'org-1' };

describe('setPendingConfirmation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes the pending confirmation and returns the conversation id', async () => {
    const db = makeDb();
    db._returning.mockResolvedValueOnce([{ id: 'conv-1' }]);

    const result = await setPendingConfirmation(db as never, {
      ...locator,
      kind: 'ad',
      draftId: 'draft-9',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe('conv-1');
    expect(db._set).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingConfirmation: { kind: 'ad', draftId: 'draft-9' },
      })
    );
  });

  it('returns VALIDATION_ERROR for an invalid kind', async () => {
    const db = makeDb();
    const result = await setPendingConfirmation(db as never, {
      ...locator,
      kind: 'bogus' as never,
      draftId: 'draft-9',
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when no row matches', async () => {
    const db = makeDb();
    db._returning.mockResolvedValueOnce([]);
    const result = await setPendingConfirmation(db as never, {
      ...locator,
      kind: 'offer',
      draftId: 'draft-1',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    const db = makeDb();
    db._returning.mockRejectedValueOnce(new Error('boom'));
    const result = await setPendingConfirmation(db as never, {
      ...locator,
      kind: 'ad',
      draftId: 'draft-1',
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
  });
});

describe('clearPendingConfirmation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('nulls the pending confirmation', async () => {
    const db = makeDb();
    db._returning.mockResolvedValueOnce([{ id: 'conv-1' }]);
    const result = await clearPendingConfirmation(db as never, locator);
    expect(result.success).toBe(true);
    expect(db._set).toHaveBeenCalledWith(
      expect.objectContaining({ pendingConfirmation: null })
    );
  });

  it('returns NOT_FOUND when no row matches', async () => {
    const db = makeDb();
    db._returning.mockResolvedValueOnce([]);
    const result = await clearPendingConfirmation(db as never, locator);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });
});

describe('getPendingConfirmation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the stored pending confirmation', async () => {
    const db = makeDb();
    db._findFirst.mockResolvedValueOnce({
      pendingConfirmation: { kind: 'ad', draftId: 'draft-3' },
    });
    const result = await getPendingConfirmation(db as never, locator);
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data).toEqual({ kind: 'ad', draftId: 'draft-3' });
  });

  it('returns null when no confirmation is pending', async () => {
    const db = makeDb();
    db._findFirst.mockResolvedValueOnce({ pendingConfirmation: null });
    const result = await getPendingConfirmation(db as never, locator);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeNull();
  });

  it('returns NOT_FOUND when the conversation is missing', async () => {
    const db = makeDb();
    db._findFirst.mockResolvedValueOnce(undefined);
    const result = await getPendingConfirmation(db as never, locator);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });
});
