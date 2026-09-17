import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { advanceLeadStage } from './advance-lead-stage.service.js';

/** Collect the values drizzle bound into a condition. */
const boundValues = (node: unknown): unknown[] => {
  if (!node || typeof node !== 'object') return [];
  const self = 'value' in node ? [(node as { value: unknown }).value] : [];
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks ?? [];
  return [...self, ...chunks.flatMap(boundValues)];
};

const mockDb = {
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(undefined),
};

describe('advanceLeadStage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets the new status', async () => {
    await advanceLeadStage(mockDb as never, {
      leadId: 'lead-1',
      from: 'new',
      to: 'contacted',
    });

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'contacted' })
    );
  });

  // The guard lives in the WHERE clause, not a read-then-write, so two events
  // arriving at once cannot both win — and a status a human already moved on
  // is never dragged backwards by a late automated event.
  it('scopes the update to the expected current stage', async () => {
    await advanceLeadStage(mockDb as never, {
      leadId: 'lead-1',
      from: 'new',
      to: 'contacted',
    });

    expect(mockDb.where).toHaveBeenCalledTimes(1);
    const [condition] = mockDb.where.mock.calls[0];
    // Drizzle keeps bound values in `queryChunks`; the guard is real only if
    // the CURRENT status ('new') is one of them alongside the lead id.
    expect(boundValues(condition)).toEqual(
      expect.arrayContaining(['lead-1', 'new'])
    );
  });

  it('swallows a db failure — a stage is not worth failing a message for', async () => {
    mockDb.where.mockRejectedValueOnce(new Error('db down'));

    await expect(
      advanceLeadStage(mockDb as never, {
        leadId: 'lead-1',
        from: 'new',
        to: 'contacted',
      })
    ).resolves.toBeUndefined();
  });
});
