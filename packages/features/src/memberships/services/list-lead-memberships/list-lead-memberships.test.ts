import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { listLeadMemberships } from './list-lead-memberships.service.js';

describe('listLeadMemberships', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('lists memberships with plans', async () => {
    mockDb.query.leadMembership.findMany.mockResolvedValueOnce([
      {
        id: 'lm_1',
        leadId: 'lead_1',
        status: 'active',
        plan: { id: 'plan_1', name: 'Gold' },
      },
    ]);

    const result = await listLeadMemberships(mockDb as never, {
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].plan.name).toBe('Gold');
    }
  });

  it('reports an active membership past its validUntil as expired', async () => {
    mockDb.query.leadMembership.findMany.mockResolvedValueOnce([
      {
        id: 'lm_1',
        leadId: 'lead_1',
        status: 'active',
        validUntil: new Date('2020-01-01'),
        plan: { id: 'plan_1', name: 'Gold' },
      },
      {
        id: 'lm_2',
        leadId: 'lead_1',
        status: 'cancelled',
        validUntil: new Date('2020-01-01'),
        plan: { id: 'plan_1', name: 'Gold' },
      },
    ]);

    const result = await listLeadMemberships(mockDb as never, {
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // Past its validUntil while still 'active' → effective 'expired'.
      expect(result.data[0].status).toBe('expired');
      // A cancelled row is left untouched.
      expect(result.data[1].status).toBe('cancelled');
    }
  });

  it('accepts leadId and status filters', async () => {
    mockDb.query.leadMembership.findMany.mockResolvedValueOnce([]);

    const result = await listLeadMemberships(mockDb as never, {
      organizationId: 'org_123',
      leadId: 'lead_1',
      status: 'active',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual([]);
  });

  it('returns VALIDATION_ERROR for an invalid status', async () => {
    const result = await listLeadMemberships(mockDb as never, {
      organizationId: 'org_123',
      status: 'bogus' as never,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.leadMembership.findMany.mockRejectedValueOnce(
      new Error('DB failed')
    );

    const result = await listLeadMemberships(mockDb as never, {
      organizationId: 'org_123',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
