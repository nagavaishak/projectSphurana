import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { listLeadHistory } from './list-lead-history.service.js';

describe('listLeadHistory', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns VALIDATION_ERROR for missing leadId', async () => {
    const result = await listLeadHistory(mockDb as never, {
      leadId: '',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await listLeadHistory(mockDb as never, {
      leadId: 'lead-1',
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns NOT_FOUND when lead does not exist', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    const result = await listLeadHistory(mockDb as never, {
      leadId: 'lead-1',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns the lead-created milestone when there is no other history', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead-1',
      organizationId: 'org-1',
      source: 'manual',
      psid: null,
      createdAt: new Date('2024-01-01'),
    });

    // The service calls db.select().from().leftJoin().leftJoin().where().orderBy() twice
    // With createMockDatabase, all chainable methods return `this` (the same mockDb)
    // So orderBy is the terminal call that resolves; it needs to return empty arrays
    // for both calls (executions and activities)
    mockDb.orderBy
      .mockResolvedValueOnce([]) // first select (executions)
      .mockResolvedValueOnce([]); // second select (activities)

    const result = await listLeadHistory(mockDb as never, {
      leadId: 'lead-1',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // Always synthesize a "came in" milestone from the lead row.
      expect(result.data.items).toHaveLength(1);
      expect(result.data.total).toBe(1);
      expect(result.data.items[0].activity?.type).toBe('lead_created');
    }
  });

  it('returns combined and sorted history items', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead-1',
      organizationId: 'org-1',
      source: 'manual',
      psid: null,
      createdAt: new Date('2024-01-01'),
    });

    const executions = [
      {
        id: 'exec-1',
        leadId: 'lead-1',
        sequenceId: 'seq-1',
        sequenceName: 'Follow Up',
        stepId: 'step-1',
        stepType: 'email',
        stepConfig: {},
        status: 'completed',
        result: null,
        scheduledAt: new Date('2024-01-02'),
        executedAt: new Date('2024-01-02'),
        errorMessage: null,
        createdAt: new Date('2024-01-02'),
      },
    ];

    const activities = [
      {
        id: 'act-1',
        leadId: 'lead-1',
        type: 'status_change',
        description: 'Status changed to contacted',
        metadata: null,
        performedById: 'user-1',
        performedByName: 'Admin',
        createdAt: new Date('2024-01-03'),
      },
    ];

    // orderBy is the terminal call for both selects
    mockDb.orderBy
      .mockResolvedValueOnce(executions) // first select (executions)
      .mockResolvedValueOnce(activities); // second select (activities)

    const result = await listLeadHistory(mockDb as never, {
      leadId: 'lead-1',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // status_change activity (Jan 3) + execution (Jan 2) + synthesized
      // lead_created milestone (Jan 1).
      expect(result.data.items).toHaveLength(3);
      expect(result.data.total).toBe(3);
      // Should be sorted by timestamp descending
      expect(result.data.items[0].type).toBe('activity');
      expect(result.data.items[1].type).toBe('execution');
      expect(result.data.items[2].activity?.type).toBe('lead_created');
    }
  });

  it('returns VALIDATION_ERROR for negative offset', async () => {
    const result = await listLeadHistory(mockDb as never, {
      leadId: 'lead-1',
      organizationId: 'org-1',
      offset: -1,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
