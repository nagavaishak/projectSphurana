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
import { setServiceFormRequirements } from './set-service-form-requirements.service.js';

describe('setServiceFormRequirements', () => {
  const mockDb = createMockDatabase();

  const validInput = {
    organizationId: 'org_1',
    serviceId: 'svc_1',
    templateIds: ['tpl_1', 'tpl_2'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('reconciles the join table: inserts added, deletes removed', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc_1',
    });
    mockDb.query.consentFormTemplate.findMany.mockResolvedValueOnce([
      { id: 'tpl_1' },
      { id: 'tpl_2' },
    ]);
    // Existing: tpl_2 (kept) + tpl_3 (removed). tpl_1 is added.
    mockDb.query.organizationServiceFormRequirement.findMany.mockResolvedValueOnce(
      [
        { id: 'req_2', serviceId: 'svc_1', templateId: 'tpl_2' },
        { id: 'req_3', serviceId: 'svc_1', templateId: 'tpl_3' },
      ]
    );

    const result = await setServiceFormRequirements(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        serviceId: 'svc_1',
        templateIds: ['tpl_1', 'tpl_2'],
      });
    }
    expect(mockDb.delete).toHaveBeenCalledTimes(1);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    const [values] = mockDb.values.mock.calls[0];
    expect(values).toEqual([{ serviceId: 'svc_1', templateId: 'tpl_1' }]);
  });

  it('clears every requirement when templateIds is empty', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc_1',
    });
    mockDb.query.organizationServiceFormRequirement.findMany.mockResolvedValueOnce(
      [{ id: 'req_1', serviceId: 'svc_1', templateId: 'tpl_1' }]
    );

    const result = await setServiceFormRequirements(mockDb as never, {
      ...validInput,
      templateIds: [],
    });

    expect(result.success).toBe(true);
    expect(mockDb.delete).toHaveBeenCalledTimes(1);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('makes no writes when the set is already in sync', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc_1',
    });
    mockDb.query.consentFormTemplate.findMany.mockResolvedValueOnce([
      { id: 'tpl_1' },
      { id: 'tpl_2' },
    ]);
    mockDb.query.organizationServiceFormRequirement.findMany.mockResolvedValueOnce(
      [
        { id: 'req_1', serviceId: 'svc_1', templateId: 'tpl_1' },
        { id: 'req_2', serviceId: 'svc_1', templateId: 'tpl_2' },
      ]
    );

    const result = await setServiceFormRequirements(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for a service outside the org', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      setServiceFormRequirements(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when a templateId belongs to another org', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc_1',
    });
    // Only one of the two requested templates resolves in this org.
    mockDb.query.consentFormTemplate.findMany.mockResolvedValueOnce([
      { id: 'tpl_1' },
    ]);

    await expectResult(
      setServiceFormRequirements(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for a missing serviceId', async () => {
    await expectResult(
      setServiceFormRequirements(mockDb as never, {
        ...validInput,
        serviceId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on database failure', async () => {
    mockDb.query.organizationService.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      setServiceFormRequirements(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
