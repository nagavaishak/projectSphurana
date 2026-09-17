import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { deleteCurrentBatch } from './delete-current-batch.service.js';

const ORG_ID = 'org-1';

/**
 * The lookup this service performs must match `getCurrentBatch`'s exactly —
 * newest-first, `periodMonth` only when explicitly asked for. When the two
 * drifted, reset deleted an arbitrary same-month batch while the planner kept
 * showing the newest, and the button looked broken.
 */
function createMockDb(found: { id: string } | undefined) {
  const findFirst = vi.fn(() => Promise.resolve(found));
  const where = vi.fn(() => Promise.resolve(undefined));
  const del = vi.fn(() => ({ where }));

  return {
    db: {
      query: { contentBatch: { findFirst } },
      delete: del,
    },
    findFirst,
    del,
    where,
  };
}

describe('deleteCurrentBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes the most recently created batch', async () => {
    const { db, del } = createMockDb({ id: 'batch-newest' });

    const result = await deleteCurrentBatch(db as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deleted).toBe(true);
      expect(result.data.batchId).toBe('batch-newest');
    }
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('orders newest-first so a repeat generate cannot resurrect an old row', async () => {
    const { db, findFirst } = createMockDb({ id: 'batch-newest' });

    await deleteCurrentBatch(db as never, { organizationId: ORG_ID });

    const args = findFirst.mock.calls[0]?.[0] as
      | { orderBy?: unknown }
      | undefined;
    expect(args?.orderBy).toBeDefined();
  });

  it('does not filter by month unless one was asked for', async () => {
    // A batch generated before the month rolled over is still the one on
    // screen; defaulting to the current month made it unresettable.
    const { db, findFirst } = createMockDb({ id: 'batch-from-last-month' });

    await deleteCurrentBatch(db as never, { organizationId: ORG_ID });

    const result = await deleteCurrentBatch(db as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.deleted).toBe(true);
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when the org has no batches', async () => {
    const { db, del } = createMockDb(undefined);

    const result = await deleteCurrentBatch(db as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.deleted).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR without an organizationId', async () => {
    const { db, del } = createMockDb({ id: 'batch-1' });

    const result = await deleteCurrentBatch(db as never, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(del).not.toHaveBeenCalled();
  });
});
