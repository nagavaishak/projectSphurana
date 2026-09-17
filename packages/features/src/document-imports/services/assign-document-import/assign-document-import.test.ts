import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { assignDocumentImport } from './assign-document-import.service.js';

describe('assignDocumentImport', () => {
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
    status: 'needs_review',
    patientDocumentId: null,
  };
  const input = {
    organizationId: 'org_1',
    importId: 'imp_1',
    leadId: 'l_1',
    actorUserId: 'user_9',
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

  it('files a needs_review import into the chosen client’s vault as the acting user', async () => {
    mockDb.query.documentImport.findFirst
      .mockResolvedValueOnce(row) // assign guard
      .mockResolvedValueOnce(row); // finalize re-read
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'l_1',
      organizationId: 'org_1',
    });
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'doc_1' }])
      .mockResolvedValueOnce([{ ...row, status: 'matched' }]);

    const result = await assignDocumentImport(
      mockDb as never,
      storage as never,
      input
    );

    expect(result.success).toBe(true);
    const [vaultValues] = mockDb.values.mock.calls[0];
    expect(vaultValues).toMatchObject({
      leadId: 'l_1',
      uploadedByType: 'staff',
      uploadedByUserId: 'user_9',
    });
    const update = mockDb.set.mock.calls.at(-1)?.[0];
    expect(update).toMatchObject({
      status: 'matched',
      matchSource: 'manual',
      confidence: null,
      patientDocumentId: 'doc_1',
    });
  });

  it('refuses to re-file an import that is already attached', async () => {
    mockDb.query.documentImport.findFirst.mockResolvedValueOnce({
      ...row,
      status: 'matched',
    });

    const result = await assignDocumentImport(
      mockDb as never,
      storage as never,
      input
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    expect(storage.copy).not.toHaveBeenCalled();
  });

  it('refuses while the matcher still owns the row', async () => {
    mockDb.query.documentImport.findFirst.mockResolvedValueOnce({
      ...row,
      status: 'processing',
    });

    const result = await assignDocumentImport(
      mockDb as never,
      storage as never,
      input
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.CONFLICT);
  });

  it('returns NOT_FOUND for another org’s import', async () => {
    mockDb.query.documentImport.findFirst.mockResolvedValueOnce(null);

    const result = await assignDocumentImport(
      mockDb as never,
      storage as never,
      { ...input, organizationId: 'org_2' }
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('removes the copied object again if the vault row cannot be written', async () => {
    mockDb.query.documentImport.findFirst
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(row);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null); // lead not in org

    const result = await assignDocumentImport(
      mockDb as never,
      storage as never,
      input
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(storage.deleteObject).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringMatching(/^patient-documents\/org_1\/l_1\//),
      })
    );
  });
});
