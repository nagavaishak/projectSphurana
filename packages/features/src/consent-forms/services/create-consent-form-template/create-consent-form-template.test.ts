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
import { createConsentFormTemplate } from './create-consent-form-template.service.js';

describe('createConsentFormTemplate', () => {
  const mockDb = createMockDatabase();

  const validInput = {
    organizationId: 'org_1',
    title: 'Laser Treatment Consent',
    body: 'I, {{patientName}}, consent to the treatment.',
    fields: [{ type: 'text' as const, label: 'Allergies' }],
    requiresSignature: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('creates a template with valid input', async () => {
    const mockRow = { id: 'tpl_1', ...validInput, isActive: true };
    mockDb.returning.mockResolvedValueOnce([mockRow]);

    const result = await createConsentFormTemplate(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('tpl_1');
      expect(result.data.title).toBe('Laser Treatment Consent');
    }
    expect(mockDb.insert).toHaveBeenCalled();
    const [values] = mockDb.values.mock.calls[0];
    expect(values.organizationId).toBe('org_1');
    expect(values.fields).toEqual([{ type: 'text', label: 'Allergies' }]);
  });

  it('defaults fields to [] and requiresSignature to true', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'tpl_1' }]);

    const result = await createConsentFormTemplate(
      mockDb as never,
      {
        organizationId: 'org_1',
        title: 'Simple',
        body: 'Body',
      } as never
    );

    expect(result.success).toBe(true);
    const [values] = mockDb.values.mock.calls[0];
    expect(values.fields).toEqual([]);
    expect(values.requiresSignature).toBe(true);
  });

  it('returns VALIDATION_ERROR for a missing title', async () => {
    await expectResult(
      createConsentFormTemplate(mockDb as never, { ...validInput, title: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for an unknown field type', async () => {
    await expectResult(
      createConsentFormTemplate(
        mockDb as never,
        {
          ...validInput,
          fields: [{ type: 'signature', label: 'Nope' }],
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on database failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      createConsentFormTemplate(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
