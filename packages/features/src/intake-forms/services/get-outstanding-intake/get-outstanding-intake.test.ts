import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { getOutstandingIntake } from './get-outstanding-intake.service.js';

// The join returns one row per pending submission, carrying the id of the
// `form_service_requirement` that links its form to a service — null when the
// form is linked to nothing. A linked form IS a requirement now: `blocks_booking`
// has no column on the unified table (see get-service-intake-forms.service.ts).
describe('getOutstandingIntake', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;
  beforeEach(() => {
    mockDb = createMockDatabase();
  });

  const input = { organizationId: 'org-1', appointmentId: 'appt-1' };

  it('is blocked when a required form is still pending', async () => {
    mockDb.where.mockResolvedValueOnce([
      { formId: 'f1', requirementId: 'req-1' },
      { formId: 'f2', requirementId: null },
    ]);
    const result = await getOutstandingIntake(mockDb as never, input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isBlocked).toBe(true);
      expect(result.data.blockingCount).toBe(1);
      expect(result.data.pendingCount).toBe(2);
    }
  });

  it('is NOT blocked when the pending form is linked to no service', async () => {
    mockDb.where.mockResolvedValueOnce([{ formId: 'f2', requirementId: null }]);
    const result = await getOutstandingIntake(mockDb as never, input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isBlocked).toBe(false);
      expect(result.data.pendingCount).toBe(1);
    }
  });

  it('is clear when nothing is pending', async () => {
    mockDb.where.mockResolvedValueOnce([]);
    const result = await getOutstandingIntake(mockDb as never, input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isBlocked).toBe(false);
      expect(result.data.pendingCount).toBe(0);
    }
  });
});
