import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { mockQueue } from '../../../__mocks__/bullmq.js';
import { ErrorCodes } from '../../../shared/index.js';
import { completeDocumentImport } from './complete-document-import.service.js';

describe('completeDocumentImport', () => {
  const mockDb = createMockDatabase();
  const storage = {
    getOrgAssetsBucket: vi.fn().mockReturnValue('org-assets'),
    getMetadata: vi.fn(),
  };

  const row = {
    id: 'imp_1',
    organizationId: 'org_1',
    storageKey: 'document-imports/org_1/imp_1/1-abc.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 100,
    status: 'uploading',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    storage.getOrgAssetsBucket.mockReturnValue('org-assets');
    storage.getMetadata.mockResolvedValue({
      key: row.storageKey,
      size: 4096,
      contentType: 'application/pdf',
    });
    mockQueue.add.mockResolvedValue({ id: 'job_1' });
  });

  it('verifies the object, trusts S3 size/type, flips to pending and queues the matcher', async () => {
    mockDb.query.documentImport.findFirst.mockResolvedValueOnce(row);
    mockDb.returning.mockResolvedValueOnce([
      { ...row, status: 'pending', sizeBytes: 4096 },
    ]);

    const result = await completeDocumentImport(
      mockDb as never,
      storage as never,
      { organizationId: 'org_1', importId: 'imp_1' }
    );

    expect(result.success).toBe(true);
    expect(storage.getMetadata).toHaveBeenCalledWith({
      bucket: 'org-assets',
      key: row.storageKey,
    });
    const [setValues] = mockDb.set.mock.calls[0];
    expect(setValues).toEqual({
      status: 'pending',
      mimeType: 'application/pdf',
      sizeBytes: 4096,
    });
    expect(mockQueue.add).toHaveBeenCalledTimes(1);
    const [name, payload] = mockQueue.add.mock.calls[0];
    expect(name).toBe('match');
    expect(payload).toEqual({ organizationId: 'org_1', importId: 'imp_1' });
  });

  it('is idempotent — a row that already left uploading is returned untouched', async () => {
    mockDb.query.documentImport.findFirst.mockResolvedValueOnce({
      ...row,
      status: 'pending',
    });

    const result = await completeDocumentImport(
      mockDb as never,
      storage as never,
      { organizationId: 'org_1', importId: 'imp_1' }
    );

    expect(result.success).toBe(true);
    expect(storage.getMetadata).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('fails closed when the object was never PUT', async () => {
    mockDb.query.documentImport.findFirst.mockResolvedValueOnce(row);
    storage.getMetadata.mockResolvedValueOnce(null);

    const result = await completeDocumentImport(
      mockDb as never,
      storage as never,
      { organizationId: 'org_1', importId: 'imp_1' }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('marks the row failed when S3 reports a disallowed content type', async () => {
    mockDb.query.documentImport.findFirst.mockResolvedValueOnce(row);
    storage.getMetadata.mockResolvedValueOnce({
      key: row.storageKey,
      size: 10,
      contentType: 'application/zip',
    });
    mockDb.returning.mockResolvedValueOnce([{ ...row, status: 'failed' }]);

    const result = await completeDocumentImport(
      mockDb as never,
      storage as never,
      { organizationId: 'org_1', importId: 'imp_1' }
    );

    expect(result.success).toBe(false);
    const [setValues] = mockDb.set.mock.calls[0];
    expect(setValues).toMatchObject({ status: 'failed' });
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for another org’s import', async () => {
    mockDb.query.documentImport.findFirst.mockResolvedValueOnce(null);

    const result = await completeDocumentImport(
      mockDb as never,
      storage as never,
      { organizationId: 'org_2', importId: 'imp_1' }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });
});
