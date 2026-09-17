import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { deletePatientDocument } from './delete-patient-document.service.js';

describe('deletePatientDocument', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_1',
    leadId: 'lead_1',
    documentId: 'doc_1',
  };

  it('soft-deletes a document', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'doc_1' }]);

    const result = await deletePatientDocument(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('doc_1');
    }
    // Soft delete: an UPDATE setting deletedAt, never a hard DELETE.
    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(mockDb.delete).not.toHaveBeenCalled();
    const [setValues] = mockDb.set.mock.calls[0];
    expect(setValues.deletedAt).toBeInstanceOf(Date);
  });

  it('returns NOT_FOUND when no row matches (wrong org or already deleted)', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await deletePatientDocument(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns VALIDATION_ERROR without a documentId', async () => {
    const result = await deletePatientDocument(mockDb as never, {
      ...validInput,
      documentId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    const result = await deletePatientDocument(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
