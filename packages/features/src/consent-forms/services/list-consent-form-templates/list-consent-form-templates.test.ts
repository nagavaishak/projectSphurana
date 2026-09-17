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
import { listConsentFormTemplates } from './list-consent-form-templates.service.js';

describe('listConsentFormTemplates', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('lists the org templates', async () => {
    const rows = [
      { id: 'tpl_2', title: 'B' },
      { id: 'tpl_1', title: 'A' },
    ];
    mockDb.query.consentFormTemplate.findMany.mockResolvedValueOnce(rows);

    const result = await listConsentFormTemplates(mockDb as never, {
      organizationId: 'org_1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.items).toHaveLength(2);
  });

  it('accepts the string "false" for activeOnly (query-param form)', async () => {
    mockDb.query.consentFormTemplate.findMany.mockResolvedValueOnce([]);

    const result = await listConsentFormTemplates(
      mockDb as never,
      {
        organizationId: 'org_1',
        activeOnly: 'false',
      } as never
    );

    expect(result.success).toBe(true);
  });

  it('returns VALIDATION_ERROR without an organizationId', async () => {
    await expectResult(
      listConsentFormTemplates(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on database failure', async () => {
    mockDb.query.consentFormTemplate.findMany.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      listConsentFormTemplates(mockDb as never, { organizationId: 'org_1' })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
