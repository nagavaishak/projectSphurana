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
import { listConsentFormSubmissions } from './list-consent-form-submissions.service.js';

describe('listConsentFormSubmissions', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('lists submissions for an appointment', async () => {
    mockDb.query.consentFormSubmission.findMany.mockResolvedValueOnce([
      { id: 'sub_1', appointmentId: 'apt_1', status: 'pending' },
    ]);

    const result = await listConsentFormSubmissions(mockDb as never, {
      organizationId: 'org_1',
      appointmentId: 'apt_1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.items).toHaveLength(1);
  });

  it('lists submissions for a lead', async () => {
    mockDb.query.consentFormSubmission.findMany.mockResolvedValueOnce([]);

    const result = await listConsentFormSubmissions(mockDb as never, {
      organizationId: 'org_1',
      leadId: 'lead_1',
    });

    expect(result.success).toBe(true);
  });

  it('returns VALIDATION_ERROR when neither filter is provided', async () => {
    await expectResult(
      listConsentFormSubmissions(mockDb as never, { organizationId: 'org_1' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on database failure', async () => {
    mockDb.query.consentFormSubmission.findMany.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      listConsentFormSubmissions(mockDb as never, {
        organizationId: 'org_1',
        appointmentId: 'apt_1',
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
