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
import { listServiceFormRequirements } from './list-service-form-requirements.service.js';

describe('listServiceFormRequirements', () => {
  const mockDb = createMockDatabase();

  const validInput = { organizationId: 'org_1', serviceId: 'svc_1' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('lists the requirements joined with their templates', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc_1',
    });
    mockDb.query.organizationServiceFormRequirement.findMany.mockResolvedValueOnce(
      [{ id: 'req_1', serviceId: 'svc_1', templateId: 'tpl_1' }]
    );
    mockDb.query.consentFormTemplate.findMany.mockResolvedValueOnce([
      {
        id: 'tpl_1',
        title: 'Laser Consent',
        requiresSignature: true,
        isActive: true,
      },
    ]);

    const result = await listServiceFormRequirements(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toEqual([
        {
          id: 'req_1',
          templateId: 'tpl_1',
          title: 'Laser Consent',
          requiresSignature: true,
          isActive: true,
        },
      ]);
    }
  });

  it('returns an empty list when the service has no requirements', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc_1',
    });
    mockDb.query.organizationServiceFormRequirement.findMany.mockResolvedValueOnce(
      []
    );

    const result = await listServiceFormRequirements(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.items).toEqual([]);
  });

  it('returns NOT_FOUND for a service outside the org', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      listServiceFormRequirements(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for a missing serviceId', async () => {
    await expectResult(
      listServiceFormRequirements(mockDb as never, {
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
      listServiceFormRequirements(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
