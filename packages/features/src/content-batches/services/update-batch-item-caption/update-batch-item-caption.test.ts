import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { updateBatchItemCaption } from './update-batch-item-caption.service.js';

const ITEM_ID = 'item-1';
const ORG_ID = 'org-1';

// The caption lives on the ATTEMPT now, so the two halves are separate rows.
import { attemptFixture, slotFixture } from '../_shared/test-fixtures.js';

const item = (overrides: Record<string, unknown> = {}) =>
  slotFixture({ id: ITEM_ID, batchId: 'batch-1', ...overrides });

const attempt = (overrides: Record<string, unknown> = {}) =>
  attemptFixture({
    slotId: ITEM_ID,
    batchId: 'batch-1',
    caption: 'Original caption text.',
    ...overrides,
  });

function createMockDb(options: {
  itemRows?: unknown[];
  updatedRows?: unknown[];
}) {
  const {
    itemRows = [{ slot: item(), attempt: attempt(), batchOrgId: ORG_ID }],
    updatedRows = [attempt({ caption: 'Edited caption text.' })],
  } = options;

  const chain: Record<string, unknown> = {};
  const self = () => chain;

  chain.select = vi.fn(self);
  chain.from = vi.fn(self);
  chain.innerJoin = vi.fn(self);
  chain.where = vi.fn(self);
  chain.limit = vi.fn(() => Promise.resolve(itemRows));
  chain.update = vi.fn(self);
  chain.set = vi.fn(self);
  chain.returning = vi.fn(() => Promise.resolve(updatedRows));

  return chain;
}

const validInput = {
  itemId: ITEM_ID,
  organizationId: ORG_ID,
  caption: 'Edited caption text.',
};

describe('updateBatchItemCaption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes the caption verbatim', async () => {
    const db = createMockDb({});

    const result = await updateBatchItemCaption(db as never, validInput);

    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data.caption).toBe('Edited caption text.');
    expect(db.set).toHaveBeenCalledWith({ caption: 'Edited caption text.' });
  });

  it('returns NOT_FOUND for another org’s item', async () => {
    const db = createMockDb({
      itemRows: [],
    });

    const result = await updateBatchItemCaption(db as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('refuses to edit a decided post', async () => {
    const db = createMockDb({
      itemRows: [
        {
          slot: item({ reviewStatus: 'rejected' }),
          attempt: attempt(),
          batchOrgId: ORG_ID,
        },
      ],
    });

    const result = await updateBatchItemCaption(db as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('reports the race when the post is decided mid-edit', async () => {
    // Guard passes, then the conditional UPDATE matches nothing because another
    // tab accepted it. Saying so beats silently reporting success.
    const db = createMockDb({ updatedRows: [] });

    const result = await updateBatchItemCaption(db as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
      expect(result.error.message).toMatch(/while you were editing/i);
    }
  });

  it('returns VALIDATION_ERROR for an empty caption', async () => {
    const db = createMockDb({});

    const result = await updateBatchItemCaption(db as never, {
      ...validInput,
      caption: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(db.select).not.toHaveBeenCalled();
  });
});
