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
import { getLead } from './get-lead.service.js';

describe('getLead', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'lead_123',
    organizationId: 'org_123',
  };

  it('should return lead when found', async () => {
    const mockLead = {
      id: 'lead_123',
      organizationId: 'org_123',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      status: 'new',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);

    const result = await getLead(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(validInput.id);
      expect(result.data.firstName).toBe('John');
    }
  });

  it('should resolve the source lead form for a meta_lead_form lead', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead_123',
      organizationId: 'org_123',
      firstName: 'John',
      source: 'meta_lead_form',
      formData: { form_id: 'meta_form_456' },
      status: 'new',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce({
      id: 'form_internal_1',
      name: 'Haircut Enquiry',
    });

    const result = await getLead(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sourceLeadForm).toEqual({
        id: 'form_internal_1',
        name: 'Haircut Enquiry',
      });
    }
  });

  it('should return null sourceLeadForm for non-meta leads', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead_123',
      organizationId: 'org_123',
      firstName: 'John',
      source: 'manual',
      status: 'new',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await getLead(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sourceLeadForm).toBeNull();
    }
    expect(mockDb.query.leadForm.findFirst).not.toHaveBeenCalled();
  });

  it('should return NOT_FOUND when lead does not exist', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    await expectResult(getLead(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(error.message).toContain(validInput.id);
      }
    );
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {
      organizationId: 'org_123',
    };

    await expectResult(
      getLead(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.lead.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      id: 'lead_123',
    };

    await expectResult(
      getLead(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.lead.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty id', async () => {
    const invalidInput = {
      id: '',
      organizationId: 'org_123',
    };

    await expectResult(getLead(mockDb as never, invalidInput)).toFailWithCode(
      ErrorCodes.VALIDATION_ERROR
    );
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = {
      id: 'lead_123',
      organizationId: '',
    };

    await expectResult(getLead(mockDb as never, invalidInput)).toFailWithCode(
      ErrorCodes.VALIDATION_ERROR
    );
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.lead.findFirst.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(getLead(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });
});
