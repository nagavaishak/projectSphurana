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
import { listLeadForms } from './list-lead-forms.service.js';

const mockDb = createMockDatabase();

const mockForms = [
  { id: 'form-1', name: 'Form A', status: 'draft' },
  { id: 'form-2', name: 'Form B', status: 'synced' },
];

describe('listLeadForms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('should return paginated lead forms', async () => {
    mockDb.query.leadForm.findMany
      .mockResolvedValueOnce(mockForms) // items query
      .mockResolvedValueOnce(mockForms); // count query

    const result = await listLeadForms(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.total).toBe(2);
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    }
  });

  it('should return empty list when no forms exist', async () => {
    mockDb.query.leadForm.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await listLeadForms(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(0);
      expect(result.data.total).toBe(0);
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      listLeadForms(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.leadForm.findMany).not.toHaveBeenCalled();
  });

  it('should pass status filter to query', async () => {
    mockDb.query.leadForm.findMany
      .mockResolvedValueOnce([mockForms[1]])
      .mockResolvedValueOnce([mockForms[1]]);

    const result = await listLeadForms(mockDb as never, {
      organizationId: 'org-1',
      status: 'synced',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(1);
      expect(result.data.total).toBe(1);
    }
  });

  it('should respect custom limit and offset', async () => {
    mockDb.query.leadForm.findMany
      .mockResolvedValueOnce([mockForms[0]])
      .mockResolvedValueOnce(mockForms);

    const result = await listLeadForms(mockDb as never, {
      organizationId: 'org-1',
      limit: 1,
      offset: 0,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(1);
      expect(result.data.offset).toBe(0);
    }
  });
});
