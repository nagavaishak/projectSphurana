import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { type MockDb, createMockDb } from '../shared/mock-db.test-utils.js';
import {
  ORG_ID,
  OTHER_ORG_ID,
  SITE_ID,
  micrositeRow,
  pageRow,
} from '../shared/test-fixtures.test-utils.js';
import { publishMicrosite } from './publish-microsite.service.js';

let db: MockDb;

const base = { micrositeId: SITE_ID, organizationId: ORG_ID };

describe('publishMicrosite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.query.microsite.findFirst.mockResolvedValue(micrositeRow());
    db.query.micrositePage.findMany.mockResolvedValue([pageRow()]);
    db.insertReturning.mockResolvedValue([
      {
        id: 'rev-2',
        micrositeId: SITE_ID,
        organizationId: ORG_ID,
        label: null,
        createdBy: 'user',
        promptId: null,
        createdAt: new Date('2026-01-03T00:00:00Z'),
      },
    ]);
    db.updateReturning.mockResolvedValue([
      { id: SITE_ID, publishedRevisionId: 'rev-2' },
    ]);
  });

  it('snapshots and points the microsite at the new revision', async () => {
    const result = await publishMicrosite(db as never, {
      ...base,
      label: 'Launch',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.publishedRevisionId).toBe('rev-2');
    expect(result.data.status).toBe('published');
    expect(result.data.pageCount).toBe(1);

    // Snapshot and pointer move commit together, or not at all.
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.set).toHaveBeenCalledWith({
      publishedRevisionId: 'rev-2',
      status: 'published',
    });
  });

  it('defaults the author to user and accepts system for provisioning', async () => {
    await publishMicrosite(db as never, base);
    expect(
      (db.values.mock.calls[0]?.[0] as { createdBy: string }).createdBy
    ).toBe('user');

    vi.clearAllMocks();
    db.query.microsite.findFirst.mockResolvedValue(micrositeRow());
    db.query.micrositePage.findMany.mockResolvedValue([pageRow()]);
    db.insertReturning.mockResolvedValue([
      {
        id: 'rev-3',
        micrositeId: SITE_ID,
        organizationId: ORG_ID,
        label: null,
        createdBy: 'system',
        promptId: null,
        createdAt: new Date(),
      },
    ]);
    db.updateReturning.mockResolvedValue([
      { id: SITE_ID, publishedRevisionId: 'rev-3' },
    ]);

    await publishMicrosite(db as never, { ...base, createdBy: 'system' });
    expect(
      (db.values.mock.calls[0]?.[0] as { createdBy: string }).createdBy
    ).toBe('system');
  });

  /** The undo target: what was live BEFORE this publish. */
  it('reports the outgoing revision as the previous one', async () => {
    db.query.microsite.findFirst.mockResolvedValue(
      micrositeRow({ publishedRevisionId: 'rev-1', status: 'published' })
    );

    const result = await publishMicrosite(db as never, base);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.previousRevisionId).toBe('rev-1');
  });

  it('returns null as the previous revision on a first publish', async () => {
    const result = await publishMicrosite(db as never, base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.previousRevisionId).toBeNull();
  });

  it('returns NOT_FOUND and writes nothing for another org', async () => {
    db.query.microsite.findFirst.mockResolvedValue(undefined);

    const result = await publishMicrosite(db as never, {
      ...base,
      organizationId: OTHER_ORG_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  /**
   * A failed snapshot must NOT leave the site published against a revision that
   * does not exist — `publishedRevisionId` is not a foreign key, so only the
   * transaction protects that pointer.
   */
  it('does not move the pointer when the snapshot fails', async () => {
    db.insertReturning.mockRejectedValueOnce(new Error('DB failed'));

    const result = await publishMicrosite(db as never, base);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for a missing organizationId', async () => {
    const result = await publishMicrosite(db as never, {
      micrositeId: SITE_ID,
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
