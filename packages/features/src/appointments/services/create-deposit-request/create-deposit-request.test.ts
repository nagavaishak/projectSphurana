import { mockStripeConnectService } from '@borradh-workspace/integrations/stripe';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

import { createDepositRequest } from './create-deposit-request.service.js';

describe('createDepositRequest', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    appointmentId: 'appt_123',
    organizationId: 'org_123',
    amountCents: 5000,
    currency: 'usd',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
  };

  const mockAppointment = {
    id: 'appt_123',
    organizationId: 'org_123',
    startDate: new Date('2024-03-15T10:00:00Z'),
    title: 'Consultation',
  };

  const mockIntegration = {
    id: 'int_123',
    organizationId: 'org_123',
    stripeAccountId: 'acct_123',
    isActive: true,
    chargesEnabled: true,
    depositExpirationHours: 24,
  };

  const mockCheckoutResult = {
    sessionId: 'cs_test_123',
    url: 'https://checkout.stripe.com/cs_test_123',
  };

  const mockDeposit = {
    id: 'dep_123',
    appointmentId: 'appt_123',
    organizationId: 'org_123',
    amountCents: 5000,
    currency: 'usd',
    status: 'pending',
    stripeCheckoutSessionId: 'cs_test_123',
    stripeConnectedAccountId: 'acct_123',
    checkoutUrl: 'https://checkout.stripe.com/cs_test_123',
  };

  it('should create deposit request successfully', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(mockAppointment);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(null);
    mockStripeConnectService.createDepositCheckout.mockResolvedValueOnce(
      mockCheckoutResult
    );
    mockDb.returning.mockResolvedValueOnce([mockDeposit]);

    const result = await createDepositRequest(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deposit).toBeDefined();
      expect(result.data.checkoutUrl).toBe(
        'https://checkout.stripe.com/cs_test_123'
      );
    }

    expect(mockStripeConnectService.createDepositCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        connectedAccountId: 'acct_123',
        amountCents: 5000,
        currency: 'usd',
      })
    );
  });

  it('passes the appointment service tax-code override to Stripe Checkout', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      ...mockAppointment,
      serviceId: 'svc_123',
    });
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(null);
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      taxCode: 'txcd_99999999',
    });
    mockStripeConnectService.createDepositCheckout.mockResolvedValueOnce(
      mockCheckoutResult
    );
    mockDb.returning.mockResolvedValueOnce([mockDeposit]);

    await createDepositRequest(mockDb as never, validInput);

    expect(mockStripeConnectService.createDepositCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ taxCode: 'txcd_99999999' })
    );
  });

  it('should use custom expirationHours when provided', async () => {
    const inputWithExpiration = { ...validInput, expirationHours: 48 };
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(mockAppointment);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(null);
    mockStripeConnectService.createDepositCheckout.mockResolvedValueOnce(
      mockCheckoutResult
    );
    mockDb.returning.mockResolvedValueOnce([mockDeposit]);

    const result = await createDepositRequest(
      mockDb as never,
      inputWithExpiration
    );

    expect(result.success).toBe(true);
  });

  it('should return NOT_FOUND when appointment does not exist', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      createDepositRequest(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toBe('Appointment not found');
    });
  });

  it('should return INVALID_STATE when Stripe Connect is not configured', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(mockAppointment);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      createDepositRequest(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.INVALID_STATE);
      expect(error.message).toContain('Stripe Connect not configured');
    });
  });

  it('should return INVALID_STATE when integration is not active', async () => {
    const inactiveIntegration = { ...mockIntegration, isActive: false };
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(mockAppointment);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      inactiveIntegration
    );

    await expectResult(
      createDepositRequest(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.INVALID_STATE);
      expect(error.message).toContain('not active');
    });
  });

  it('should return INVALID_STATE when charges are not enabled', async () => {
    const noChargesIntegration = { ...mockIntegration, chargesEnabled: false };
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(mockAppointment);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      noChargesIntegration
    );

    await expectResult(
      createDepositRequest(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.INVALID_STATE);
      expect(error.message).toContain('cannot accept payments');
    });
  });

  it('should return ALREADY_EXISTS when a pending deposit already exists', async () => {
    const existingDeposit = { id: 'dep_existing', status: 'pending' };
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(mockAppointment);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(
      existingDeposit
    );

    await expectResult(
      createDepositRequest(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.ALREADY_EXISTS);
      expect(error.message).toContain('pending deposit request already exists');
    });
  });

  it('should return VALIDATION_ERROR for missing appointmentId', async () => {
    await expectResult(
      createDepositRequest(mockDb as never, {
        ...validInput,
        appointmentId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.query.appointment.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      createDepositRequest(mockDb as never, {
        ...validInput,
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.query.appointment.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for negative amountCents', async () => {
    await expectResult(
      createDepositRequest(mockDb as never, {
        ...validInput,
        amountCents: -100,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.query.appointment.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for zero amountCents', async () => {
    await expectResult(
      createDepositRequest(mockDb as never, { ...validInput, amountCents: 0 })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.query.appointment.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for invalid successUrl', async () => {
    await expectResult(
      createDepositRequest(mockDb as never, {
        ...validInput,
        successUrl: 'not-a-url',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid cancelUrl', async () => {
    await expectResult(
      createDepositRequest(mockDb as never, {
        ...validInput,
        cancelUrl: 'not-a-url',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR on Stripe checkout failure', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(mockAppointment);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(null);
    mockStripeConnectService.createDepositCheckout.mockRejectedValueOnce(
      new Error('Stripe API error')
    );

    await expectResult(
      createDepositRequest(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('should return INTERNAL_ERROR on database insert failure', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(mockAppointment);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(null);
    mockStripeConnectService.createDepositCheckout.mockResolvedValueOnce(
      mockCheckoutResult
    );
    mockDb.returning.mockRejectedValueOnce(new Error('Database insert failed'));

    await expectResult(
      createDepositRequest(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
