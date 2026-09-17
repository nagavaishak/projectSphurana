import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { type MockDb, createMockDb } from '../shared/mock-db.test-utils.js';
import {
  ORG_ID,
  OTHER_ORG_ID,
  SITE_ID,
  micrositeRow,
} from '../shared/test-fixtures.test-utils.js';
import { listRevisions } from './list-revisions.service.js';

let db: MockDb;

const base = { micrositeId: SITE_ID, organizationId: ORG_ID };

const at = (minute: number) => new Date(Date.UTC(2026, 0, 2, 12, minute, 0));

const historyRow = (id: string, minute: number) => ({
  id,
  label: `Turn ${id}`,
  createdBy: 'agent' as const,
  promptId: `prompt-${id}`,
  createdAt: at(minute),
});

/** rev-3 newest → rev-0 oldest, the order the sidebar renders. */
const HISTORY = [
  historyRow('rev-3', 3),
  historyRow('rev-2', 2),
  historyRow('rev-1', 1),
  historyRow('rev-0', 0),
];

/**
 * `countChangesSincePublish` resolves the DRAFT pointer first, then the
 * PUBLISHED one — keep this order in step with the service.
 */
const pointers = (
  draft: { createdAt: Date } | undefined,
  published?: {
    createdAt: Date;
  }
) => {
  db.query.micrositeRevision.findFirst
    .mockResolvedValueOnce(draft)
    .mockResolvedValueOnce(published);
};

describe('listRevisions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.query.microsite.findFirst.mockResolvedValue(micrositeRow());
    db.query.micrositeRevision.findMany.mockResolvedValue(HISTORY);
    db.selectRows.mockResolvedValue([{ value: 0 }]);
  });

  it('returns the history newest-first with the pointer flags set', async () => {
    db.query.microsite.findFirst.mockResolvedValue(
      micrositeRow({ publishedRevisionId: 'rev-0', draftRevisionId: 'rev-3' })
    );
    pointers(historyRow('rev-3', 3), historyRow('rev-0', 0));
    db.selectRows.mockResolvedValue([{ value: 3 }]);

    const result = await listRevisions(db as never, base);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.items.map((i) => i.id)).toEqual([
      'rev-3',
      'rev-2',
      'rev-1',
      'rev-0',
    ]);
    expect(result.data.items[0]).toMatchObject({
      label: 'Turn rev-3',
      createdBy: 'agent',
      promptId: 'prompt-rev-3',
      isDraft: true,
      isPublished: false,
    });
    expect(result.data.items[3]).toMatchObject({
      isPublished: true,
      isDraft: false,
    });
    // Snapshots are never returned — a 20-row history would be megabytes.
    expect(result.data.items[0]).not.toHaveProperty('pages');
  });

  it('pages with a composite cursor and stops when the history ends', async () => {
    const noCursor = await listRevisions(db as never, base);
    expect(noCursor.success && noCursor.data.nextCursor).toBe(null);

    db.query.micrositeRevision.findMany.mockResolvedValue(HISTORY);
    const paged = await listRevisions(db as never, { ...base, limit: 2 });

    expect(paged.success).toBe(true);
    if (!paged.success) return;
    expect(paged.data.items.map((i) => i.id)).toEqual(['rev-3', 'rev-2']);
    // `${createdAt}|${id}` — a bare timestamp would drop a revision written in
    // the same millisecond as the one before it.
    expect(paged.data.nextCursor).toBe(`${at(2).toISOString()}|rev-2`);
  });

  it('returns VALIDATION_ERROR for a malformed cursor', async () => {
    const result = await listRevisions(db as never, {
      ...base,
      cursor: 'not-a-cursor',
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  describe('changesSincePublish', () => {
    it('is 0 straight after a publish, without a count query', async () => {
      db.query.microsite.findFirst.mockResolvedValue(
        micrositeRow({ publishedRevisionId: 'rev-3', draftRevisionId: 'rev-3' })
      );

      const result = await listRevisions(db as never, base);

      expect(result.success && result.data.changesSincePublish).toBe(0);
      expect(db.select).not.toHaveBeenCalled();
    });

    it('counts the revisions after the published one, up to the draft', async () => {
      db.query.microsite.findFirst.mockResolvedValue(
        micrositeRow({ publishedRevisionId: 'rev-0', draftRevisionId: 'rev-3' })
      );
      pointers(historyRow('rev-3', 3), historyRow('rev-0', 0));
      db.selectRows.mockResolvedValue([{ value: 3 }]);

      const result = await listRevisions(db as never, base);

      expect(result.success && result.data.changesSincePublish).toBe(3);
      expect(db.select).toHaveBeenCalledTimes(1);
    });

    it('drops by one after an undo moves the draft back a turn', async () => {
      db.query.microsite.findFirst.mockResolvedValue(
        micrositeRow({ publishedRevisionId: 'rev-0', draftRevisionId: 'rev-2' })
      );
      pointers(historyRow('rev-2', 2), historyRow('rev-0', 0));
      db.selectRows.mockResolvedValue([{ value: 2 }]);

      const result = await listRevisions(db as never, base);

      expect(result.success && result.data.changesSincePublish).toBe(2);
    });

    /** A draft restored to or behind the live revision has nothing pending. */
    it('is 0 when the draft is older than the published revision', async () => {
      db.query.microsite.findFirst.mockResolvedValue(
        micrositeRow({ publishedRevisionId: 'rev-3', draftRevisionId: 'rev-1' })
      );
      pointers(historyRow('rev-1', 1), historyRow('rev-3', 3));

      const result = await listRevisions(db as never, base);

      expect(result.success && result.data.changesSincePublish).toBe(0);
      expect(db.select).not.toHaveBeenCalled();
    });

    it('counts everything up to the draft when the site was never published', async () => {
      db.query.microsite.findFirst.mockResolvedValue(
        micrositeRow({ publishedRevisionId: null, draftRevisionId: 'rev-3' })
      );
      pointers(historyRow('rev-3', 3), undefined);
      db.selectRows.mockResolvedValue([{ value: 4 }]);

      const result = await listRevisions(db as never, base);

      expect(result.success && result.data.changesSincePublish).toBe(4);
    });

    it('is 0 when nothing has been snapshotted yet', async () => {
      const result = await listRevisions(db as never, base);

      expect(result.success && result.data.changesSincePublish).toBe(0);
      expect(db.select).not.toHaveBeenCalled();
    });
  });

  it('returns NOT_FOUND for another org and reads no revisions', async () => {
    db.query.microsite.findFirst.mockResolvedValue(undefined);

    const result = await listRevisions(db as never, {
      ...base,
      organizationId: OTHER_ORG_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(db.query.micrositeRevision.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing micrositeId', { micrositeId: '' }],
    ['a missing organizationId', { organizationId: '' }],
    ['a limit above the cap', { limit: 500 }],
  ])('returns VALIDATION_ERROR for %s', async (_label, patch) => {
    const result = await listRevisions(db as never, { ...base, ...patch });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(db.query.micrositeRevision.findMany).not.toHaveBeenCalled();
  });
});
