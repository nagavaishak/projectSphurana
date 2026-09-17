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
import { updateConsentFormTemplate } from './update-consent-form-template.service.js';

describe('updateConsentFormTemplate', () => {
  const mockDb = createMockDatabase();

  const validInput = {
    id: 'tpl_1',
    organizationId: 'org_1',
    title: 'Updated Title',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('updates a template and returns the row', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'tpl_1', title: 'Updated Title' },
    ]);

    const result = await updateConsentFormTemplate(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.title).toBe('Updated Title');
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Updated Title' })
    );
    // id/organizationId are WHERE filters, never SET values.
    const [setValues] = mockDb.set.mock.calls[0];
    expect(setValues).not.toHaveProperty('id');
    expect(setValues).not.toHaveProperty('organizationId');
  });

  it('can deactivate a template via isActive', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'tpl_1', isActive: false }]);

    const result = await updateConsentFormTemplate(mockDb as never, {
      id: 'tpl_1',
      organizationId: 'org_1',
      isActive: false,
    });

    expect(result.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false })
    );
  });

  it('returns NOT_FOUND when no row matches (wrong org or missing id)', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      updateConsentFormTemplate(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for a missing id', async () => {
    await expectResult(
      updateConsentFormTemplate(mockDb as never, { ...validInput, id: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on database failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      updateConsentFormTemplate(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
