import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { deleteConsentFormTemplate } from './delete-consent-form-template.service.js';

describe('deleteConsentFormTemplate', () => {
  const mockDb = createMockDatabase();

  const validInput = { id: 'tpl_1', organizationId: 'org_1' };
  const mockTemplate = { id: 'tpl_1', organizationId: 'org_1', isActive: true };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('hard-deletes when no submissions reference the template', async () => {
    mockDb.query.consentFormTemplate.findFirst.mockResolvedValueOnce(
      mockTemplate
    );
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(null);

    const result = await deleteConsentFormTemplate(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ id: 'tpl_1', softDeleted: false });
    }
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('soft-deletes (isActive=false) when a submission references it', async () => {
    mockDb.query.consentFormTemplate.findFirst.mockResolvedValueOnce(
      mockTemplate
    );
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce({
      id: 'sub_1',
    });

    const result = await deleteConsentFormTemplate(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ id: 'tpl_1', softDeleted: true });
    }
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({ isActive: false });
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for a template outside the org', async () => {
    mockDb.query.consentFormTemplate.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      deleteConsentFormTemplate(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for a missing id', async () => {
    await expectResult(
      deleteConsentFormTemplate(mockDb as never, { ...validInput, id: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on database failure', async () => {
    mockDb.query.consentFormTemplate.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      deleteConsentFormTemplate(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
