import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { FALLBACK_MICROSITE_THEME } from '../shared/index.js';
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
import { getMicrositeDocument } from './get-microsite-document.service.js';

let db: MockDb;

const base = { micrositeId: SITE_ID, organizationId: ORG_ID };

describe('getMicrositeDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.query.microsite.findFirst.mockResolvedValue(micrositeRow());
    db.query.micrositePage.findMany.mockResolvedValue([pageRow()]);
  });

  it('returns the draft document from the page rows', async () => {
    const result = await getMicrositeDocument(db as never, {
      ...base,
      mode: 'draft',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.mode).toBe('draft');
    expect(result.data.revisionId).toBeNull();
    expect(result.data.theme).toEqual(THEME);
    expect(result.data.pages).toHaveLength(1);
    expect(result.data.pages[0].blocks).toEqual([HERO_BLOCK]);
  });

  it('defaults to draft mode', async () => {
    const result = await getMicrositeDocument(db as never, base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.mode).toBe('draft');
  });

  /**
   * THE POINT OF THE TWO-SOURCE SPLIT: an agent mid-edit in the draft must be
   * invisible to the public, so published reads the snapshot and NOTHING else.
   */
  it('serves the published snapshot, not the diverged draft', async () => {
    db.query.microsite.findFirst.mockResolvedValue(
      micrositeRow({ publishedRevisionId: 'rev-1' })
    );
    db.query.micrositePage.findMany.mockResolvedValue([
      pageRow({ title: 'Half-written draft', blocks: [CTA_BLOCK] }),
    ]);
    db.query.micrositeRevision.findFirst.mockResolvedValue({
      id: 'rev-1',
      theme: THEME,
      pages: [
        {
          id: 'page-home',
          path: '/',
          title: 'Home',
          seo: {},
          blocks: [HERO_BLOCK],
          order: 0,
          isSystem: true,
        },
      ],
    });

    const result = await getMicrositeDocument(db as never, {
      ...base,
      mode: 'published',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.revisionId).toBe('rev-1');
    expect(result.data.pages[0].title).toBe('Home');
    expect(result.data.pages[0].blocks).toEqual([HERO_BLOCK]);
    // The draft rows were never read in published mode.
    expect(db.query.micrositePage.findMany).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND in published mode when nothing is published', async () => {
    const result = await getMicrositeDocument(db as never, {
      ...base,
      mode: 'published',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    // Never silently falls back to the draft — that would publish by accident.
    expect(db.query.micrositePage.findMany).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when publishedRevisionId dangles', async () => {
    db.query.microsite.findFirst.mockResolvedValue(
      micrositeRow({ publishedRevisionId: 'rev-gone' })
    );
    db.query.micrositeRevision.findFirst.mockResolvedValue(undefined);

    const result = await getMicrositeDocument(db as never, {
      ...base,
      mode: 'published',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  /* ── Authorization boundary (plan §12) ──────────────────────────── */

  it('returns NOT_FOUND for a microsite belonging to another org', async () => {
    // The org predicate is part of the WHERE clause, so the row simply misses.
    db.query.microsite.findFirst.mockResolvedValue(undefined);

    const result = await getMicrositeDocument(db as never, {
      ...base,
      organizationId: OTHER_ORG_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      // NOT_FOUND, never FORBIDDEN — FORBIDDEN confirms the id exists.
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
    // Nothing further was read, and nothing at all was written.
    expect(db.query.micrositePage.findMany).not.toHaveBeenCalled();
    expect(db.query.micrositeRevision.findFirst).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('requires an organizationId', async () => {
    const result = await getMicrositeDocument(db as never, {
      micrositeId: SITE_ID,
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(db.query.microsite.findFirst).not.toHaveBeenCalled();
  });

  /* ── jsonb that lies (see ../shared/document.ts) ────────────────── */

  it('drops an unparseable block instead of failing the page', async () => {
    db.query.micrositePage.findMany.mockResolvedValue([
      pageRow({ blocks: [HERO_BLOCK, LEGACY_BROKEN_BLOCK, CTA_BLOCK] }),
    ]);

    const result = await getMicrositeDocument(db as never, base);

    expect(result.success).toBe(true);
    if (!result.success) return;
    // The good blocks survive, in order; the bad one is gone.
    expect(result.data.pages[0].blocks.map((b) => b.id)).toEqual([
      HERO_BLOCK.id,
      CTA_BLOCK.id,
    ]);
  });

  it('drops an unparseable block inside a published snapshot too', async () => {
    db.query.microsite.findFirst.mockResolvedValue(
      micrositeRow({ publishedRevisionId: 'rev-1' })
    );
    db.query.micrositeRevision.findFirst.mockResolvedValue({
      id: 'rev-1',
      theme: THEME,
      pages: [
        {
          id: 'p1',
          path: '/',
          title: 'Home',
          seo: {},
          blocks: [LEGACY_BROKEN_BLOCK, CTA_BLOCK],
          order: 0,
          isSystem: true,
        },
        // Not even page-shaped — dropped whole rather than half-rendered.
        { nonsense: true },
      ],
    });

    const result = await getMicrositeDocument(db as never, {
      ...base,
      mode: 'published',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pages).toHaveLength(1);
    expect(result.data.pages[0].blocks).toEqual([CTA_BLOCK]);
  });

  it('degrades unparseable seo to empty metadata', async () => {
    db.query.micrositePage.findMany.mockResolvedValue([
      pageRow({ seo: { title: 42 } }),
    ]);

    const result = await getMicrositeDocument(db as never, base);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.pages[0].seo).toEqual({});
  });

  /**
   * A theme CANNOT be dropped — an unstyled page is not a degraded page. It
   * falls back to the engine defaults so the site still renders.
   */
  it('falls back to the default theme when the stored theme is invalid', async () => {
    db.query.microsite.findFirst.mockResolvedValue(
      micrositeRow({ theme: { brand: { primary: 'not-a-colour' } } })
    );

    const result = await getMicrositeDocument(db as never, base);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.theme).toEqual(FALLBACK_MICROSITE_THEME);
    }
  });
});
