import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { type MockDb, createMockDb } from '../shared/mock-db.test-utils.js';
import {
  CTA_BLOCK,
  HERO_BLOCK,
  LEGACY_BROKEN_BLOCK,
  ORG_ID,
  OTHER_ORG_ID,
  SITE_ID,
  THEME,
  micrositeRow,
} from '../shared/test-fixtures.test-utils.js';
import { restoreRevision } from './restore-revision.service.js';

let db: MockDb;

const base = {
  micrositeId: SITE_ID,
  organizationId: ORG_ID,
  revisionId: 'rev-1',
};

const snapshotPage = (overrides: Record<string, unknown> = {}) => ({
  id: 'page-home',
  path: '/',
  title: 'Home',
  seo: {},
  blocks: [HERO_BLOCK],
  order: 0,
  isSystem: true,
  ...overrides,
});

const revisionRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'rev-1',
  pages: [snapshotPage()],
  theme: THEME,
  ...overrides,
});

/** The page rows the service asked the database to write. */
const insertedPages = () =>
  (db.values.mock.calls[0]?.[0] ?? []) as {
    id: string;
    path: string;
    blocks: { id: string }[];
    isSystem: boolean;
  }[];

describe('restoreRevision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.query.microsite.findFirst.mockResolvedValue(
      micrositeRow({ draftRevisionId: 'rev-9' })
    );
    db.query.micrositeRevision.findFirst.mockResolvedValue(revisionRow());
  });

  it('rewrites the draft pages from the snapshot and moves the draft pointer', async () => {
    const result = await restoreRevision(db as never, base);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      micrositeId: SITE_ID,
      draftRevisionId: 'rev-1',
      previousDraftRevisionId: 'rev-9',
      pageCount: 1,
    });

    expect(insertedPages()[0]?.blocks).toEqual([HERO_BLOCK]);
    expect(db.set).toHaveBeenCalledWith({
      draftRevisionId: 'rev-1',
      theme: THEME,
    });
  });

  /**
   * A half-restored page set is a broken live site the moment it is published,
   * so the delete, the insert and the pointer move are one unit — and the
   * pages are cleared before they are rewritten, or a page added after this
   * revision would survive an undo.
   */
  it('does the whole restore in one transaction', async () => {
    await restoreRevision(db as never, base);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  /**
   * Undo/redo means the same revision gets restored repeatedly. Reusing the
   * snapshot's page ids is what makes the second restore land on the same rows
   * as the first instead of minting new ones.
   */
  it('is idempotent — a second restore writes the same rows', async () => {
    const first = await restoreRevision(db as never, base);
    const firstPages = insertedPages();

    vi.clearAllMocks();
    db.query.microsite.findFirst.mockResolvedValue(
      micrositeRow({ draftRevisionId: 'rev-1' })
    );
    db.query.micrositeRevision.findFirst.mockResolvedValue(revisionRow());

    const second = await restoreRevision(db as never, base);

    expect(first.success && second.success).toBe(true);
    expect(insertedPages()).toEqual(firstPages);
    expect(insertedPages()[0]?.id).toBe('page-home');
  });

  it('returns NOT_FOUND and mutates nothing for another org', async () => {
    db.query.microsite.findFirst.mockResolvedValue(undefined);

    const result = await restoreRevision(db as never, {
      ...base,
      organizationId: OTHER_ORG_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(db.query.micrositeRevision.findFirst).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  /**
   * The org predicate is on the revision lookup too — a revision id belonging
   * to another tenant's site must not resolve, and must read as NOT_FOUND
   * rather than FORBIDDEN (FORBIDDEN confirms the id exists).
   */
  it('returns NOT_FOUND and mutates nothing for a revision from another site', async () => {
    db.query.micrositeRevision.findFirst.mockResolvedValue(undefined);

    const result = await restoreRevision(db as never, {
      ...base,
      revisionId: 'rev-from-elsewhere',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  /**
   * A revision can predate a block-schema change. Throwing would strand the
   * tenant on the very draft they are trying to undo, so the bad block is
   * dropped and logged and the rest of the page is restored.
   */
  it('drops an invalid block from the snapshot instead of throwing', async () => {
    db.query.micrositeRevision.findFirst.mockResolvedValue(
      revisionRow({
        pages: [snapshotPage({ blocks: [LEGACY_BROKEN_BLOCK, CTA_BLOCK] })],
      })
    );

    const result = await restoreRevision(db as never, base);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pageCount).toBe(1);
    expect(insertedPages()[0]?.blocks.map((b) => b.id)).toEqual([CTA_BLOCK.id]);
  });

  it('clears the pages when the snapshot held none', async () => {
    db.query.micrositeRevision.findFirst.mockResolvedValue(
      revisionRow({ pages: [] })
    );

    const result = await restoreRevision(db as never, base);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.pageCount).toBe(0);
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing micrositeId', { micrositeId: '' }],
    ['a missing organizationId', { organizationId: '' }],
    ['a missing revisionId', { revisionId: '' }],
  ])('returns VALIDATION_ERROR for %s', async (_label, patch) => {
    const result = await restoreRevision(db as never, { ...base, ...patch });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when the write fails', async () => {
    db.deleteWhere.mockRejectedValueOnce(new Error('DB failed'));

    const result = await restoreRevision(db as never, base);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
  });
});
