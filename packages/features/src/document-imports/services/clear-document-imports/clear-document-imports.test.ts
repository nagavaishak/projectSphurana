import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { clearDocumentImports } from './clear-document-imports.service.js';

describe('clearDocumentImports', () => {
  const mockDb = createMockDatabase();
  const storage = {
    getOrgAssetsBucket: vi.fn(() => 'org-assets'),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  };

  const row = (id: string, status: string) => ({
    id,
    organizationId: 'org_1',
    status,
    storageKey: `document-imports/org_1/${id}/f.pdf`,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    storage.getOrgAssetsBucket.mockReturnValue('org-assets');
    storage.deleteObject.mockResolvedValue(undefined);
  });

  it('soft-deletes the finished rows and reports how many went', async () => {
    mockDb.returning.mockResolvedValueOnce([
      row('i_1', 'matched'),
      row('i_2', 'failed'),
    ]);

    const result = await clearDocumentImports(mockDb as never, storage, {
      organizationId: 'org_1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ cleared: 2 });

    // Soft delete only — the filed copies in each client's documents are a
    // different table and must survive being tidied up after.
    const [values] = mockDb.set.mock.calls[0];
    expect(values).toEqual({ deletedAt: expect.any(Date) });
  });

  /**
   * A failed row still owns its staged object — nothing will ever read it
   * again, so clearing the row should take the bytes with it. A matched row
   * has none left: finalizing copied the file into the vault and deleted the
   * original, and deleting by that key again would be pointless at best.
   */
  it('drops the staged object for failed rows only', async () => {
    mockDb.returning.mockResolvedValueOnce([
      row('i_matched', 'matched'),
      row('i_failed', 'failed'),
    ]);

    await clearDocumentImports(mockDb as never, storage, {
      organizationId: 'org_1',
    });

    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    expect(storage.deleteObject).toHaveBeenCalledWith({
      bucket: 'org-assets',
      key: 'document-imports/org_1/i_failed/f.pdf',
    });
  });

  it('reports zero rather than failing when there is nothing to clear', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await clearDocumentImports(mockDb as never, storage, {
      organizationId: 'org_1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ cleared: 0 });
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when the update fails', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('db down'));

    const result = await clearDocumentImports(mockDb as never, storage, {
      organizationId: 'org_1',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('rejects a call with no organization', async () => {
    const result = await clearDocumentImports(mockDb as never, storage, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('VALIDATION_ERROR');
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
