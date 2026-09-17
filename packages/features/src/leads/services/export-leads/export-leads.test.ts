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
import { exportLeads } from './export-leads.service.js';

describe('exportLeads', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const baseInput = {
    organizationId: 'org_123',
  };

  it('should export all leads for an organization', async () => {
    const mockLeads = [
      {
        id: 'lead_1',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        organizationId: 'org_123',
      },
      {
        id: 'lead_2',
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@example.com',
        organizationId: 'org_123',
      },
    ];

    mockDb.query.lead.findMany.mockResolvedValueOnce(mockLeads);

    const result = await exportLeads(mockDb as never, baseInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      exportLeads(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return empty array when no leads exist', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    const result = await exportLeads(mockDb as never, baseInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(0);
    }
  });

  it('should filter by status', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    const result = await exportLeads(mockDb as never, {
      ...baseInput,
      status: 'new',
    });

    expect(result.success).toBe(true);
    expect(mockDb.query.lead.findMany).toHaveBeenCalled();
  });

  it('should filter by source', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    const result = await exportLeads(mockDb as never, {
      ...baseInput,
      source: 'facebook',
    });

    expect(result.success).toBe(true);
    expect(mockDb.query.lead.findMany).toHaveBeenCalled();
  });
});
