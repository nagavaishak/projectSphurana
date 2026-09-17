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
import { createLead } from './create-lead.service.js';

describe('createLead', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    phone: '+1234567890',
    source: 'manual' as const,
    status: 'new' as const,
  };

  it('should create a lead with valid input', async () => {
    const mockLead = {
      id: 'lead_123',
      ...validInput,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock: no existing lead found
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
    // Mock: insert returns the created lead
    mockDb.returning.mockResolvedValueOnce([mockLead]);

    const result = await createLead(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.firstName).toBe(validInput.firstName);
      expect(result.data.email).toBe(validInput.email);
      expect(result.data.organizationId).toBe(validInput.organizationId);
    }

    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should create a lead without email', async () => {
    const inputWithoutEmail = {
      organizationId: 'org_123',
      firstName: 'John',
      source: 'manual' as const,
    };

    const mockLead = {
      id: 'lead_123',
      ...inputWithoutEmail,
      email: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([mockLead]);

    const result = await createLead(mockDb as never, inputWithoutEmail);

    expect(result.success).toBe(true);
    // Should not check for duplicate since no email
    expect(mockDb.query.lead.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing firstName', async () => {
    const invalidInput = {
      organizationId: 'org_123',
      email: 'john@example.com',
    };

    await expectResult(
      createLead(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      firstName: 'John',
      email: 'john@example.com',
    };

    await expectResult(
      createLead(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for invalid email format', async () => {
    const invalidInput = {
      ...validInput,
      email: 'invalid-email',
    };

    await expectResult(
      createLead(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return ALREADY_EXISTS if lead with same email exists in organization', async () => {
    const existingLead = {
      id: 'existing_lead',
      ...validInput,
    };

    // Mock: existing lead found
    mockDb.query.lead.findFirst.mockResolvedValueOnce(existingLead);

    await expectResult(createLead(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.ALREADY_EXISTS);
        expect(error.message).toContain(validInput.email);
      }
    );

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should create lead with all optional fields', async () => {
    const fullInput = {
      ...validInput,
      lastName: 'Doe',
      whatsapp: '+1234567890',
      facebookLeadId: 'fb_123',
      formData: { field1: 'value1' },
      assignedToId: 'user_123',
      tags: ['vip', 'hot'],
      notes: 'Important lead',
      metadata: { source_detail: 'landing_page' },
    };

    const mockLead = {
      id: 'lead_123',
      ...fullInput,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([mockLead]);

    const result = await createLead(mockDb as never, fullInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual(['vip', 'hot']);
      expect(result.data.notes).toBe('Important lead');
    }
  });

  it('should use default values for status and source', async () => {
    const minimalInput = {
      organizationId: 'org_123',
      firstName: 'John',
    };

    const mockLead = {
      id: 'lead_123',
      organizationId: 'org_123',
      firstName: 'John',
      status: 'new',
      source: 'manual',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([mockLead]);

    const result = await createLead(mockDb as never, minimalInput);

    expect(result.success).toBe(true);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'new',
        source: 'manual',
      })
    );
  });

  it('should persist consent fields when creating a lead', async () => {
    const inputWithConsent = {
      ...validInput,
      consentEmail: true,
      consentSms: false,
      consentVoice: true,
      consentSource: 'manual_entry' as const,
    };

    const mockLead = {
      id: 'lead_123',
      ...inputWithConsent,
      consentedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([mockLead]);

    const result = await createLead(mockDb as never, inputWithConsent);

    expect(result.success).toBe(true);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        consentEmail: true,
        consentSms: false,
        consentVoice: true,
        consentSource: 'manual_entry',
      })
    );
  });

  it('should set consentedAt when any consent is true', async () => {
    const inputWithConsent = {
      ...validInput,
      consentEmail: true,
    };

    const mockLead = {
      id: 'lead_123',
      ...inputWithConsent,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([mockLead]);

    await createLead(mockDb as never, inputWithConsent);

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        consentedAt: expect.any(Date),
      })
    );
  });

  it('should set consentedAt to null when no consent is given', async () => {
    const inputWithoutConsent = {
      ...validInput,
      consentEmail: false,
      consentSms: false,
      consentVoice: false,
    };

    const mockLead = {
      id: 'lead_123',
      ...inputWithoutConsent,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([mockLead]);

    await createLead(mockDb as never, inputWithoutConsent);

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        consentedAt: null,
      })
    );
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(createLead(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });

  it('reports a missing organization as NOT_FOUND, not an unexpected error', async () => {
    // A session can outlive its organization, and every write then violates
    // `lead_organization_id_organization_id_fk`. Unguarded that surfaced as
    // INTERNAL_ERROR / "An unexpected error occurred" — which is what made
    // these 500s undiagnosable from the outside.
    const fkError = Object.assign(new Error('Failed query: insert into lead'), {
      cause: Object.assign(
        new Error(
          'insert or update on table "lead" violates foreign key constraint "lead_organization_id_organization_id_fk"'
        ),
        {
          code: '23503',
          constraint_name: 'lead_organization_id_organization_id_fk',
        }
      ),
    });
    mockDb.returning.mockRejectedValueOnce(fkError);

    const result = await createLead(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(result.error.message).toMatch(/no longer exists/i);
  });
});
