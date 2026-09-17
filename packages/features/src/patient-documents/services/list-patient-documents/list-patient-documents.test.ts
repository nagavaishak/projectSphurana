import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import {
  listPatientDocumentsForPatient,
  listPatientDocumentsForStaff,
} from './list-patient-documents.service.js';

describe('listPatientDocuments', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_1', leadId: 'lead_1' };
  const mockDocs = [
    { id: 'doc_2', fileName: 'aftercare.pdf', deletedAt: null },
    { id: 'doc_1', fileName: 'id-photo.jpg', deletedAt: null },
  ];

  describe('listPatientDocumentsForPatient', () => {
    it('returns the patient documents', async () => {
      mockDb.query.patientDocument.findMany.mockResolvedValueOnce(mockDocs);

      const result = await listPatientDocumentsForPatient(
        mockDb as never,
        validInput
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items).toHaveLength(2);
        expect(result.data.items[0].id).toBe('doc_2');
      }
    });

    it('returns VALIDATION_ERROR without a leadId', async () => {
      const result = await listPatientDocumentsForPatient(mockDb as never, {
        ...validInput,
        leadId: '',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
      expect(mockDb.query.patientDocument.findMany).not.toHaveBeenCalled();
    });
  });

  describe('listPatientDocumentsForStaff', () => {
    it('returns the documents for a lead', async () => {
      mockDb.query.patientDocument.findMany.mockResolvedValueOnce(mockDocs);

      const result = await listPatientDocumentsForStaff(
        mockDb as never,
        validInput
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items).toHaveLength(2);
      }
    });

    it('returns an empty list when the lead has no documents', async () => {
      mockDb.query.patientDocument.findMany.mockResolvedValueOnce([]);

      const result = await listPatientDocumentsForStaff(
        mockDb as never,
        validInput
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items).toEqual([]);
      }
    });

    it('returns VALIDATION_ERROR without an organizationId', async () => {
      const result = await listPatientDocumentsForStaff(mockDb as never, {
        ...validInput,
        organizationId: '',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });
  });
});
