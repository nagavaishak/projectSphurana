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
import { updateLead } from './update-lead.service.js';

describe('updateLead', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'lead_123',
    organizationId: 'org_123',
    firstName: 'Updated John',
    status: 'contacted' as const,
  };

  const existingLead = {
    id: 'lead_123',
    organizationId: 'org_123',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    status: 'new',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('should update lead with valid input', async () => {
    const updatedLead = {
      ...existingLead,
      firstName: validInput.firstName,
      status: validInput.status,
    };

    mockDb.query.lead.findFirst.mockResolvedValueOnce(existingLead);
    mockDb.returning.mockResolvedValueOnce([updatedLead]);

    const result = await updateLead(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.firstName).toBe('Updated John');
      expect(result.data.status).toBe('contacted');
    }

    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should return NOT_FOUND when lead does not exist', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    await expectResult(updateLead(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(error.message).toContain(validInput.id);
      }
    );

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {
      organizationId: 'org_123',
      firstName: 'Updated John',
    };

    await expectResult(
      updateLead(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.lead.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      id: 'lead_123',
      firstName: 'Updated John',
    };

    await expectResult(
      updateLead(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.lead.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for invalid email format', async () => {
    const invalidInput = {
      ...validInput,
      email: 'invalid-email',
    };

    await expectResult(
      updateLead(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid status', async () => {
    const invalidInput = {
      ...validInput,
      status: 'invalid_status',
    };

    await expectResult(
      updateLead(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid source', async () => {
    const invalidInput = {
      ...validInput,
      source: 'invalid_source',
    };

    await expectResult(
      updateLead(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should update only provided fields', async () => {
    const partialUpdate = {
      id: 'lead_123',
      organizationId: 'org_123',
      status: 'contacted' as const,
    };

    mockDb.query.lead.findFirst.mockResolvedValueOnce(existingLead);
    mockDb.returning.mockResolvedValueOnce([
      { ...existingLead, status: 'contacted' },
    ]);

    const result = await updateLead(mockDb as never, partialUpdate);

    expect(result.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'contacted',
      })
    );
  });

  it('should update multiple fields at once', async () => {
    const multiFieldUpdate = {
      id: 'lead_123',
      organizationId: 'org_123',
      firstName: 'New Name',
      lastName: 'New Last',
      email: 'new@example.com',
      phone: '+9999999999',
      status: 'booked' as const,
      tags: ['vip', 'priority'],
      notes: 'Updated notes',
    };

    const updatedLead = { ...existingLead, ...multiFieldUpdate };

    mockDb.query.lead.findFirst.mockResolvedValueOnce(existingLead);
    mockDb.returning.mockResolvedValueOnce([updatedLead]);

    const result = await updateLead(mockDb as never, multiFieldUpdate);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.firstName).toBe('New Name');
      expect(result.data.tags).toEqual(['vip', 'priority']);
    }
  });

  it('should update consent fields and set consentSource to user_update', async () => {
    const consentUpdate = {
      id: 'lead_123',
      organizationId: 'org_123',
      consentEmail: true,
      consentSms: true,
      consentVoice: false,
    };

    const updatedLead = {
      ...existingLead,
      consentEmail: true,
      consentSms: true,
      consentVoice: false,
      consentSource: 'user_update',
    };

    mockDb.query.lead.findFirst.mockResolvedValueOnce(existingLead);
    mockDb.returning.mockResolvedValueOnce([updatedLead]);

    const result = await updateLead(mockDb as never, consentUpdate);

    expect(result.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        consentEmail: true,
        consentSms: true,
        consentVoice: false,
        consentSource: 'user_update',
        consentedAt: expect.any(Date),
      })
    );
  });

  it('should not set consentSource when no consent fields are changed', async () => {
    const nonConsentUpdate = {
      id: 'lead_123',
      organizationId: 'org_123',
      firstName: 'Updated Name',
    };

    mockDb.query.lead.findFirst.mockResolvedValueOnce(existingLead);
    mockDb.returning.mockResolvedValueOnce([
      { ...existingLead, firstName: 'Updated Name' },
    ]);

    await updateLead(mockDb as never, nonConsentUpdate);

    const setCall = mockDb.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setCall.consentSource).toBeUndefined();
    expect(setCall.consentedAt).toBeUndefined();
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(existingLead);
    mockDb.returning.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(updateLead(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });
});
