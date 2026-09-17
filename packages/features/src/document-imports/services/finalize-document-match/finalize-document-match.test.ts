import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { finalizeDocumentMatch } from './finalize-document-match.service.js';

describe('finalizeDocumentMatch', () => {
  const mockDb = createMockDatabase();
  const storage = {
    getOrgAssetsBucket: vi.fn().mockReturnValue('org-assets'),
    getS3Region: vi.fn().mockReturnValue('eu-west-1'),
    getMetadata: vi.fn(),
    copy: vi.fn(),
    deleteObject: vi.fn(),
  };
  const row = {
    id: 'imp_1',
    organizationId: 'org_1',
    uploadedByUserId: 'user_1',
    fileName: 'id.jpg',
    storageKey: 'document-imports/org_1/imp_1/1-abc.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 100,
    status: 'processing',
    patientDocumentId: null,
    deletedAt: null,
  };
  const input = {
    organizationId: 'org_1',
    importId: 'imp_1',
    leadId: 'l_1',
    matchSource: 'auto' as const,
    confidence: 0.95,
    reason: 'Exact email match',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    storage.getOrgAssetsBucket.mockReturnValue('org-assets');
    storage.getS3Region.mockReturnValue('eu-west-1');
    storage.copy.mockResolvedValue({});
    storage.deleteObject.mockResolvedValue(undefined);
    storage.getMetadata.mockResolvedValue({
      key: 'k',
      size: 100,
      contentType: 'image/jpeg',
    });
  });

  it('copies the staged file into the client’s vault and records the match', async () => {
    mockDb.query.documentImport.findFirst.mockResolvedValueOnce(row);
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'l_1',
      organizationId: 'org_1',
    });
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'doc_1' }])
      .mockResolvedValueOnce([{ ...row, status: 'matched' }]);

    const result = await finalizeDocumentMatch(
      mockDb as never,
      storage as never,
      input
    );

    expect(result.success).toBe(true);
    expect(storage.copy).toHaveBeenCalledTimes(1);
    expect(mockDb.set.mock.calls.at(-1)?.[0]).toMatchObject({
      status: 'matched',
      matchSource: 'auto',
      patientDocumentId: 'doc_1',
    });
  });

  it('does not file a discarded import — the lookup only sees live rows', async () => {
    // Staff discarded the row while the worker was extracting; the soft-delete
    // makes the scoped lookup miss.
    mockDb.query.documentImport.findFirst.mockResolvedValueOnce(undefined);

    const result = await finalizeDocumentMatch(
      mockDb as never,
      storage as never,
      input
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(storage.copy).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('rolls the vault row back when the discard lands after the copy', async () => {
    mockDb.query.documentImport.findFirst.mockResolvedValueOnce(row);
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'l_1',
      organizationId: 'org_1',
    });
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'doc_1' }]) // vault row created
      .mockResolvedValueOnce([]); // …then the live-scoped match write misses

    const result = await finalizeDocumentMatch(
      mockDb as never,
      storage as never,
      input
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    // The orphan must not survive in the client's documents.
    expect(mockDb.delete).toHaveBeenCalled();
    expect(storage.deleteObject).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringMatching(/^patient-documents\/org_1\/l_1\//),
      })
    );
    // The staged object is NOT dropped — the discard owns that cleanup.
    expect(storage.deleteObject).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: row.storageKey })
    );
  });

  it('is idempotent once the import already points at a vault row', async () => {
    mockDb.query.documentImport.findFirst.mockResolvedValueOnce({
      ...row,
      status: 'matched',
      patientDocumentId: 'doc_1',
    });

    const result = await finalizeDocumentMatch(
      mockDb as never,
      storage as never,
      input
    );

    expect(result.success).toBe(true);
    expect(storage.copy).not.toHaveBeenCalled();
  });
});
