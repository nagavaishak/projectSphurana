import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { discardDocumentImport } from './discard-document-import.service.js';

describe('discardDocumentImport', () => {
  const mockDb = createMockDatabase();
  const storage = {
    getOrgAssetsBucket: vi.fn().mockReturnValue('org-assets'),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  };
  const row = {
    id: 'imp_1',
    organizationId: 'org_1',
    storageKey: 'document-imports/org_1/imp_1/1-abc.pdf',
    status: 'needs_review',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    storage.getOrgAssetsBucket.mockReturnValue('org-assets');
    storage.deleteObject.mockResolvedValue(undefined);
  });

  it('soft-deletes the row and drops the staged object', async () => {
    mockDb.query.documentImport.findFirst.mockResolvedValueOnce(row);

    const result = await discardDocumentImport(
      mockDb as never,
      storage as never,
      { organizationId: 'org_1', importId: 'imp_1' }
    );

    expect(result.success).toBe(true);
    const [setValues] = mockDb.set.mock.calls[0];
    expect(setValues).toMatchObject({ status: 'discarded' });
    expect(setValues.deletedAt).toBeInstanceOf(Date);
    expect(storage.deleteObject).toHaveBeenCalledWith({
      bucket: 'org-assets',
      key: row.storageKey,
    });
  });

  it('refuses to discard a file that already lives in a client’s vault', async () => {
    mockDb.query.documentImport.findFirst.mockResolvedValueOnce({
      ...row,
      status: 'matched',
    });

    const result = await discardDocumentImport(
      mockDb as never,
      storage as never,
      { organizationId: 'org_1', importId: 'imp_1' }
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for another org’s import', async () => {
    mockDb.query.documentImport.findFirst.mockResolvedValueOnce(null);

    const result = await discardDocumentImport(
      mockDb as never,
      storage as never,
      { organizationId: 'org_2', importId: 'imp_1' }
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });
});
