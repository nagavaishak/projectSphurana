import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
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

const mockStripeConnectService = vi.mocked(getStripeConnectService());

import { createPayment } from './create-payment.service.js';

describe('createPayment', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    amountCents: 5000,
    currency: 'eur',
    description: 'Test payment',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
  };

  const activeIntegration = {
    id: 'int_123',
    organizationId: 'org_123',
    stripeAccountId: 'acct_stripe_123',
    isActive: true,
    chargesEnabled: true,
  };

  it('should create payment with valid input', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      activeIntegration
    );
    mockStripeConnectService.createPaymentCheckout.mockResolvedValueOnce({
      sessionId: 'cs_test_123',
      url: 'https://checkout.stripe.com/cs_test_123',
    });
    const mockPayment = {
      id: 'pay_123',
      organizationId: 'org_123',
      amountCents: 5000,
      status: 'pending',
    };
    mockDb.returning.mockResolvedValueOnce([mockPayment]);

    const result = await createPayment(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payment).toEqual(mockPayment);
      expect(result.data.checkoutUrl).toBe(
        'https://checkout.stripe.com/cs_test_123'
      );
    }
    expect(mockStripeConnectService.createPaymentCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        connectedAccountId: 'acct_stripe_123',
        amountCents: 5000,
        currency: 'eur',
      })
    );
  });

  it('should pass leadId to Stripe metadata when provided', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      activeIntegration
    );
    mockStripeConnectService.createPaymentCheckout.mockResolvedValueOnce({
      sessionId: 'cs_test_123',
      url: 'https://checkout.stripe.com/cs_test_123',
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'pay_123' }]);

    await createPayment(mockDb as never, {
      ...validInput,
      leadId: 'lead_456',
    });

    expect(mockStripeConnectService.createPaymentCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ leadId: 'lead_456' }),
      })
    );
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const { organizationId: _, ...input } = validInput;

    await expectResult(
      createPayment(mockDb as never, input as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(
      mockDb.query.stripeConnectIntegration.findFirst
    ).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing description', async () => {
    await expectResult(
      createPayment(mockDb as never, {
        ...validInput,
        description: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid amountCents', async () => {
    await expectResult(
      createPayment(mockDb as never, { ...validInput, amountCents: -100 })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid successUrl', async () => {
    await expectResult(
      createPayment(mockDb as never, {
        ...validInput,
        successUrl: 'not-a-url',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INVALID_STATE when Stripe Connect not configured', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(null);

    await expectResult(createPayment(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.INVALID_STATE);
        expect(error.message).toContain('Stripe Connect not configured');
      }
    );
  });

  it('should return INVALID_STATE when integration is inactive', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      ...activeIntegration,
      isActive: false,
    });

    await expectResult(createPayment(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.INVALID_STATE);
        expect(error.message).toContain('not active');
      }
    );
  });

  it('should return INVALID_STATE when charges not enabled', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      ...activeIntegration,
      chargesEnabled: false,
    });

    await expectResult(createPayment(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.INVALID_STATE);
        expect(error.message).toContain('cannot accept payments');
      }
    );
  });

  it('should return INTERNAL_ERROR on DB failure', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      activeIntegration
    );
    mockStripeConnectService.createPaymentCheckout.mockResolvedValueOnce({
      sessionId: 'cs_test_123',
      url: 'https://checkout.stripe.com/cs_test_123',
    });
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      createPayment(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('should return INTERNAL_ERROR when Stripe checkout fails', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      activeIntegration
    );
    mockStripeConnectService.createPaymentCheckout.mockRejectedValueOnce(
      new Error('Stripe error')
    );

    await expectResult(
      createPayment(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
