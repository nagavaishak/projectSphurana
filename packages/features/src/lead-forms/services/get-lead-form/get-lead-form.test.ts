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
import { getLeadForm } from './get-lead-form.service.js';

const mockDb = createMockDatabase();

const mockForm = {
  id: 'form-1',
  organizationId: 'org-1',
  name: 'Contact Form',
  questions: [{ type: 'EMAIL' }],
  status: 'draft',
  metaPage: null,
  createdBy: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
};

describe('getLeadForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('should return lead form when found', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(mockForm);

    const result = await getLeadForm(mockDb as never, { id: 'form-1' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('form-1');
      expect(result.data.name).toBe('Contact Form');
    }
  });

  it('should return NOT_FOUND when form does not exist', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getLeadForm(mockDb as never, { id: 'nonexistent' })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for empty id', async () => {
    await expectResult(getLeadForm(mockDb as never, { id: '' })).toFailWithCode(
      ErrorCodes.VALIDATION_ERROR
    );

    expect(mockDb.query.leadForm.findFirst).not.toHaveBeenCalled();
  });

  it('should accept optional organizationId for access control', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(mockForm);

    const result = await getLeadForm(mockDb as never, {
      id: 'form-1',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
  });
});
