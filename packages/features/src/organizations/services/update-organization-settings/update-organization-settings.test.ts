import { createMockDatabase, expectResult } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { updateOrganizationSettings } from './update-organization-settings.service.js';

describe('updateOrganizationSettings', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    name: 'Updated Salon Name',
    primaryColor: '#FF5733',
    secondaryColor: '#33FF57',
  };

  const existingOrg = {
    id: 'org_123',
    name: 'My Salon',
    slug: 'my-salon',
    logo: null,
    primaryColor: null,
    secondaryColor: null,
    tagline: null,
    contentStyleTemplate: 'clean_minimal',
  };

  it('should update organization settings with valid input', async () => {
    const updatedOrg = {
      id: 'org_123',
      name: validInput.name,
      slug: 'my-salon',
      logo: null,
      primaryColor: validInput.primaryColor,
      secondaryColor: validInput.secondaryColor,
      tagline: null,
      contentStyleTemplate: 'clean_minimal',
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.returning.mockResolvedValueOnce([updatedOrg]);

    const result = await updateOrganizationSettings(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe(validInput.name);
      expect(result.data.primaryColor).toBe(validInput.primaryColor);
      expect(result.data.secondaryColor).toBe(validInput.secondaryColor);
    }
  });

  it('should update only provided fields', async () => {
    const partialInput = {
      organizationId: 'org_123',
      primaryColor: '#FF0000',
    };

    const updatedOrg = {
      ...existingOrg,
      primaryColor: '#FF0000',
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.returning.mockResolvedValueOnce([updatedOrg]);

    const result = await updateOrganizationSettings(
      mockDb as never,
      partialInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.primaryColor).toBe('#FF0000');
      expect(result.data.name).toBe(existingOrg.name); // unchanged
    }
  });

  it('should update the customer cancellation policy fields', async () => {
    const policyInput = {
      organizationId: 'org_123',
      customerCancellationsEnabled: false,
      cancellationNoticeRequiredHours: 24,
    };

    const updatedOrg = {
      ...existingOrg,
      customerCancellationsEnabled: false,
      cancellationNoticeRequiredHours: 24,
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.returning.mockResolvedValueOnce([updatedOrg]);

    const result = await updateOrganizationSettings(
      mockDb as never,
      policyInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customerCancellationsEnabled).toBe(false);
      expect(result.data.cancellationNoticeRequiredHours).toBe(24);
    }
  });

  it('should update the customer rescheduling policy field', async () => {
    const policyInput = {
      organizationId: 'org_123',
      customerReschedulingEnabled: false,
    };

    const updatedOrg = {
      ...existingOrg,
      customerReschedulingEnabled: false,
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.returning.mockResolvedValueOnce([updatedOrg]);

    const result = await updateOrganizationSettings(
      mockDb as never,
      policyInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customerReschedulingEnabled).toBe(false);
    }
  });

  it('should return VALIDATION_ERROR for cancellation notice above 48 hours', async () => {
    await expectResult(
      updateOrganizationSettings(mockDb as never, {
        organizationId: 'org_123',
        cancellationNoticeRequiredHours: 49,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for a negative cancellation notice', async () => {
    await expectResult(
      updateOrganizationSettings(mockDb as never, {
        organizationId: 'org_123',
        cancellationNoticeRequiredHours: -1,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should update name successfully', async () => {
    const nameOnlyInput = {
      organizationId: 'org_123',
      name: 'New Salon Name',
    };

    const updatedOrg = {
      ...existingOrg,
      name: 'New Salon Name',
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.returning.mockResolvedValueOnce([updatedOrg]);

    const result = await updateOrganizationSettings(
      mockDb as never,
      nameOnlyInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('New Salon Name');
    }
  });

  it('should update logo URL', async () => {
    const logoInput = {
      organizationId: 'org_123',
      logo: 'https://example.com/logo.png',
    };

    const updatedOrg = {
      ...existingOrg,
      logo: 'https://example.com/logo.png',
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.returning.mockResolvedValueOnce([updatedOrg]);

    const result = await updateOrganizationSettings(mockDb as never, logoInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logo).toBe('https://example.com/logo.png');
    }
  });

  it('should update tagline', async () => {
    const taglineInput = {
      organizationId: 'org_123',
      tagline: 'Best salon in town',
    };

    const updatedOrg = {
      ...existingOrg,
      tagline: 'Best salon in town',
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.returning.mockResolvedValueOnce([updatedOrg]);

    const result = await updateOrganizationSettings(
      mockDb as never,
      taglineInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tagline).toBe('Best salon in town');
    }
  });

  it('should update contentStyleTemplate', async () => {
    const styleInput = {
      organizationId: 'org_123',
      contentStyleTemplate: 'bold_energetic' as const,
    };

    const updatedOrg = {
      ...existingOrg,
      contentStyleTemplate: 'bold_energetic',
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.returning.mockResolvedValueOnce([updatedOrg]);

    const result = await updateOrganizationSettings(
      mockDb as never,
      styleInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contentStyleTemplate).toBe('bold_energetic');
    }
  });

  it('should allow setting logo to null', async () => {
    const nullLogoInput = {
      organizationId: 'org_123',
      logo: null,
    };

    const orgWithLogo = {
      ...existingOrg,
      logo: 'https://example.com/old-logo.png',
    };

    const updatedOrg = {
      ...existingOrg,
      logo: null,
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(orgWithLogo);
    mockDb.returning.mockResolvedValueOnce([updatedOrg]);

    const result = await updateOrganizationSettings(
      mockDb as never,
      nullLogoInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logo).toBeNull();
    }
  });

  it('should return NOT_FOUND when organization does not exist', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      updateOrganizationSettings(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toBe('Organization not found');
    });
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      name: 'New Name',
    };

    await expectResult(
      updateOrganizationSettings(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = {
      organizationId: '',
      name: 'New Name',
    };

    await expectResult(
      updateOrganizationSettings(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR when no fields to update', async () => {
    const emptyInput = {
      organizationId: 'org_123',
    };

    await expectResult(
      updateOrganizationSettings(mockDb as never, emptyInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(error.message).toBe('No fields to update');
    });
  });

  it('should return VALIDATION_ERROR for invalid hex color', async () => {
    const invalidColorInput = {
      organizationId: 'org_123',
      primaryColor: 'not-a-hex-color',
    };

    await expectResult(
      updateOrganizationSettings(mockDb as never, invalidColorInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid hex color format', async () => {
    const invalidColorInput = {
      organizationId: 'org_123',
      primaryColor: '#GGGGGG', // invalid hex characters
    };

    await expectResult(
      updateOrganizationSettings(mockDb as never, invalidColorInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should accept 3-digit hex colors', async () => {
    const shortHexInput = {
      organizationId: 'org_123',
      primaryColor: '#F00', // short hex format
    };

    const updatedOrg = {
      ...existingOrg,
      primaryColor: '#F00',
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.returning.mockResolvedValueOnce([updatedOrg]);

    const result = await updateOrganizationSettings(
      mockDb as never,
      shortHexInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.primaryColor).toBe('#F00');
    }
  });

  it('should return VALIDATION_ERROR for invalid logo URL', async () => {
    const invalidLogoInput = {
      organizationId: 'org_123',
      logo: 'not-a-valid-url',
    };

    await expectResult(
      updateOrganizationSettings(mockDb as never, invalidLogoInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for name too long', async () => {
    const longNameInput = {
      organizationId: 'org_123',
      name: 'A'.repeat(101), // exceeds 100 char limit
    };

    await expectResult(
      updateOrganizationSettings(mockDb as never, longNameInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for tagline too long', async () => {
    const longTaglineInput = {
      organizationId: 'org_123',
      tagline: 'A'.repeat(201), // exceeds 200 char limit
    };

    await expectResult(
      updateOrganizationSettings(mockDb as never, longTaglineInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid contentStyleTemplate', async () => {
    const invalidStyleInput = {
      organizationId: 'org_123',
      contentStyleTemplate: 'invalid_template',
    };

    await expectResult(
      updateOrganizationSettings(mockDb as never, invalidStyleInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.returning.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    const result = await updateOrganizationSettings(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(result.error.message).toBe(
        'Failed to update organization settings'
      );
    }
  });

  // `default_payment_policy` is what the booking resolver reads, but nothing
  // writes it — every surface only sets `depositEnabled`. Before the backfill
  // an adapter inferred one from the other, so the toggle worked by accident;
  // if these break, switching deposits on collects nothing.
  describe('deposit toggle keeps default_payment_policy in lockstep', () => {
    const setValues = () => mockDb.set.mock.calls[0]?.[0];

    it('sets the policy to deposit when the toggle goes on', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        ...existingOrg,
        defaultPaymentPolicy: 'in_clinic',
      });
      mockDb.returning.mockResolvedValueOnce([existingOrg]);

      await updateOrganizationSettings(mockDb as never, {
        organizationId: 'org_123',
        depositEnabled: true,
      });

      expect(setValues()).toMatchObject({
        depositEnabled: true,
        defaultPaymentPolicy: 'deposit',
      });
    });

    it('sets the policy back to in_clinic when the toggle goes off', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        ...existingOrg,
        defaultPaymentPolicy: 'deposit',
      });
      mockDb.returning.mockResolvedValueOnce([existingOrg]);

      await updateOrganizationSettings(mockDb as never, {
        organizationId: 'org_123',
        depositEnabled: false,
      });

      expect(setValues()).toMatchObject({
        depositEnabled: false,
        defaultPaymentPolicy: 'in_clinic',
      });
    });

    it('leaves a full-prepayment org alone', async () => {
      // Turning the deposit toggle off must not quietly downgrade an org that
      // takes payment in full to taking nothing.
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        ...existingOrg,
        defaultPaymentPolicy: 'full',
      });
      mockDb.returning.mockResolvedValueOnce([existingOrg]);

      await updateOrganizationSettings(mockDb as never, {
        organizationId: 'org_123',
        depositEnabled: false,
      });

      expect(setValues()).not.toHaveProperty('defaultPaymentPolicy');
    });

    it('does not touch the policy when the toggle is absent from the update', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        ...existingOrg,
        defaultPaymentPolicy: 'deposit',
      });
      mockDb.returning.mockResolvedValueOnce([existingOrg]);

      await updateOrganizationSettings(mockDb as never, {
        organizationId: 'org_123',
        name: 'Renamed',
      });

      expect(setValues()).not.toHaveProperty('defaultPaymentPolicy');
    });
  });

  it('should return NOT_FOUND when update returns empty array', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.returning.mockResolvedValueOnce([]); // Empty result from update

    const result = await updateOrganizationSettings(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });
});
