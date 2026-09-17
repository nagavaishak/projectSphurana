import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { getServiceIntakeForms } from './get-service-intake-forms.service.js';

describe('getServiceIntakeForms', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;
  beforeEach(() => {
    mockDb = createMockDatabase();
  });

  const input = { organizationId: 'org-1', serviceId: 'svc-1' };

  // `form_service_requirement` has no `blocks_booking` column — the join no
  // longer selects one. Every link IS a requirement, so the wire field (which
  // the HTTP contract still carries) reports true for all of them. See the note
  // in get-service-intake-forms.service.ts.
  it('returns the linked forms with name + blocksBooking for pre-population', async () => {
    mockDb.where.mockResolvedValueOnce([
      { intakeFormId: 'f1', intakeFormName: 'Medical history' },
      { intakeFormId: 'f2', intakeFormName: 'Consent' },
    ]);

    const result = await getServiceIntakeForms(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.forms).toHaveLength(2);
      expect(result.data.forms).toEqual([
        {
          intakeFormId: 'f1',
          intakeFormName: 'Medical history',
          blocksBooking: true,
        },
        { intakeFormId: 'f2', intakeFormName: 'Consent', blocksBooking: true },
      ]);
    }
  });

  it('returns an empty set for a service with no forms', async () => {
    mockDb.where.mockResolvedValueOnce([]);
    const result = await getServiceIntakeForms(mockDb as never, input);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.forms).toEqual([]);
  });
});
