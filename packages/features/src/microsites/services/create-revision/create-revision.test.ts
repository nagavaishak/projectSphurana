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
  pageRow,
} from '../shared/test-fixtures.test-utils.js';
import { createRevision } from './create-revision.service.js';

let db: MockDb;

const base = {
  micrositeId: SITE_ID,
  organizationId: ORG_ID,
  createdBy: 'agent' as const,
};

const revisionRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'rev-1',
  micrositeId: SITE_ID,
  organizationId: ORG_ID,
  label: null,
  createdBy: 'agent',
  promptId: null,
  createdAt: new Date('2026-01-02T00:00:00Z'),
  ...overrides,
});

describe('createRevision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.query.microsite.findFirst.mockResolvedValue(micrositeRow());
    db.query.micrositePage.findMany.mockResolvedValue([pageRow()]);
    db.insertReturning.mockResolvedValue([revisionRow()]);
  });

  it('snapshots the draft pages and theme', async () => {
    const result = await createRevision(db as never, {
      ...base,
      label: 'Added the team section',
      promptId: 'prompt-7',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.id).toBe('rev-1');
    expect(result.data.pages).toHaveLength(1);

    const inserted = db.values.mock.calls[0]?.[0] as {
      micrositeId: string;
      organizationId: string;
      label: string | null;
      promptId: string | null;
      theme: unknown;
      pages: { blocks: unknown[] }[];
    };
    expect(inserted.micrositeId).toBe(SITE_ID);
    expect(inserted.organizationId).toBe(ORG_ID);
    expect(inserted.label).toBe('Added the team section');
    expect(inserted.promptId).toBe('prompt-7');
    expect(inserted.theme).toEqual(THEME);
    expect(inserted.pages[0].blocks).toEqual([HERO_BLOCK]);
  });

  /**
   * Sanitize at SNAPSHOT time, not only at render time: a revision is what the
   * public is eventually served, so a block the renderer cannot draw must never
   * get into one.
   */
  it('drops an unparseable block before it enters the snapshot', async () => {
    db.query.micrositePage.findMany.mockResolvedValue([
      pageRow({ blocks: [LEGACY_BROKEN_BLOCK, CTA_BLOCK] }),
    ]);

    const result = await createRevision(db as never, base);

    expect(result.success).toBe(true);
    const inserted = db.values.mock.calls[0]?.[0] as {
      pages: { blocks: { id: string }[] }[];
    };
    expect(inserted.pages[0].blocks.map((b) => b.id)).toEqual([CTA_BLOCK.id]);
  });

  /**
   * The draft has to know which snapshot it corresponds to, or undo cannot
   * find N-1 and the Publish button cannot count what is pending.
   */
  it('points the draft at the revision it just wrote', async () => {
    await createRevision(db as never, base);

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.set).toHaveBeenCalledWith({ draftRevisionId: 'rev-1' });
  });

  it('returns NOT_FOUND and writes nothing for another org', async () => {
    db.query.microsite.findFirst.mockResolvedValue(undefined);

    const result = await createRevision(db as never, {
      ...base,
      organizationId: OTHER_ORG_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(db.query.micrositePage.findMany).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing micrositeId', { micrositeId: '' }],
    ['a missing organizationId', { organizationId: '' }],
    ['an unknown author', { createdBy: 'robot' as never }],
  ])('returns VALIDATION_ERROR for %s', async (_label, patch) => {
    const result = await createRevision(db as never, { ...base, ...patch });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when the insert fails', async () => {
    db.insertReturning.mockRejectedValueOnce(new Error('DB failed'));

    const result = await createRevision(db as never, base);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
  });
});
