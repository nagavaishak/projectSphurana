import { getStripeService } from '@borradh-workspace/integrations/stripe';
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
import { BillingErrorCodes } from '../../models/billing-error.types.js';

const mockStripeService = vi.mocked(getStripeService());

import { handleStripeWebhook } from './handle-stripe-webhook.service.js';

describe('handleStripeWebhook', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // Idempotency claim insert (`processed_webhook_event`) is the FIRST write in
    // every handler: a non-empty `returning()` means the event was newly claimed
    // (not a duplicate), so effect processing proceeds. Individual tests that
    // exercise the duplicate path override this to `[]`.
    mockDb.returning.mockResolvedValue([{ eventId: 'evt_123' }]);
  });

  const validInput = {
    payload: '{"type":"checkout.session.completed"}',
    signature: 'whsec_valid_signature',
  };

  describe('checkout.session.completed - subscription', () => {
    it('should create subscription on successful checkout', async () => {
      const event = {
        id: 'evt_123',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_123',
            customer: 'cus_abc123',
            subscription: 'sub_xyz789',
            metadata: {
              organizationId: 'org_123',
              type: 'subscription',
            },
          },
        },
      };

      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);
      mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(null); // No existing subscription
      mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(null); // No existing balance

      const result = await handleStripeWebhook(mockDb as never, validInput);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.handled).toBe(true);
        expect(result.data.eventType).toBe('checkout.session.completed');
        expect(result.data.eventId).toBe('evt_123');
      }
      expect(mockDb.insert).toHaveBeenCalled(); // Should insert subscription and balance
    });

    it('should update existing subscription on checkout', async () => {
      const event = {
        id: 'evt_123',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_123',
            customer: 'cus_abc123',
            subscription: 'sub_xyz789',
            metadata: {
              organizationId: 'org_123',
              type: 'subscription',
            },
          },
        },
      };

      const existingSubscription = {
        id: 'sub_existing',
        organizationId: 'org_123',
        status: 'canceled',
      };

      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);
      mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(
        existingSubscription
      );
      mockDb.query.creditBalances.findFirst.mockResolvedValueOnce({
        id: 'bal_123',
        balance: 50000,
      });

      const result = await handleStripeWebhook(mockDb as never, validInput);

      expect(result.success).toBe(true);
      expect(mockDb.update).toHaveBeenCalled(); // Should update subscription
    });
  });

  describe('checkout.session.completed - credits', () => {
    it('should add credits on credit purchase', async () => {
      const event = {
        id: 'evt_123',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_123',
            metadata: {
              organizationId: 'org_123',
              type: 'credits',
              credits: '50000', // 500 credits
            },
          },
        },
      };

      const existingBalance = {
        id: 'bal_123',
        organizationId: 'org_123',
        balance: 10000,
      };

      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);
      mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(
        existingBalance
      );

      const result = await handleStripeWebhook(mockDb as never, validInput);

      expect(result.success).toBe(true);
      expect(mockDb.update).toHaveBeenCalled(); // Should update balance
      expect(mockDb.insert).toHaveBeenCalled(); // Should create transaction
    });
  });

  describe('customer.subscription.updated', () => {
    it('should update subscription status', async () => {
      const event = {
        id: 'evt_123',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_xyz789',
            status: 'past_due',
            current_period_start: Math.floor(Date.now() / 1000),
            current_period_end:
              Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
            cancel_at_period_end: false,
            canceled_at: null,
            metadata: {
              organizationId: 'org_123',
            },
          },
        },
      };

      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);

      const result = await handleStripeWebhook(mockDb as never, validInput);

      expect(result.success).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should find subscription by subscription ID if no org ID in metadata', async () => {
      const event = {
        id: 'evt_123',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_xyz789',
            status: 'active',
            current_period_start: Math.floor(Date.now() / 1000),
            current_period_end:
              Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
            cancel_at_period_end: false,
            canceled_at: null,
            metadata: {},
          },
        },
      };

      const existingSubscription = {
        id: 'sub_existing',
        organizationId: 'org_123',
        stripeSubscriptionId: 'sub_xyz789',
      };

      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);
      mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(
        existingSubscription
      );

      const result = await handleStripeWebhook(mockDb as never, validInput);

      expect(result.success).toBe(true);
    });
  });

  describe('customer.subscription.deleted', () => {
    it('should update subscription with endedAt when deleted', async () => {
      const endedAtTimestamp = Math.floor(Date.now() / 1000);
      const event = {
        id: 'evt_123',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_xyz789',
            status: 'canceled',
            current_period_start:
              Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
            current_period_end: Math.floor(Date.now() / 1000),
            cancel_at_period_end: false,
            canceled_at: endedAtTimestamp - 60,
            ended_at: endedAtTimestamp,
            metadata: {
              organizationId: 'org_123',
            },
          },
        },
      };

      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);

      const result = await handleStripeWebhook(mockDb as never, validInput);

      expect(result.success).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'canceled',
          endedAt: new Date(endedAtTimestamp * 1000),
        })
      );
    });
  });

  describe('invoice.paid', () => {
    it('should create invoice record and refill credits on subscription renewal', async () => {
      const event = {
        id: 'evt_123',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'inv_123',
            customer: 'cus_abc123',
            amount_due: 4900,
            amount_paid: 4900,
            currency: 'usd',
            status: 'paid',
            billing_reason: 'subscription_cycle',
            hosted_invoice_url: 'https://invoice.stripe.com/inv_123',
            invoice_pdf: 'https://invoice.stripe.com/inv_123/pdf',
            period_start: Math.floor(Date.now() / 1000),
            period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
            status_transitions: {
              paid_at: Math.floor(Date.now() / 1000),
            },
          },
        },
      };

      const existingSubscription = {
        id: 'sub_123',
        organizationId: 'org_123',
        stripeCustomerId: 'cus_abc123',
      };

      const existingBalance = {
        id: 'bal_123',
        organizationId: 'org_123',
        balance: 5000,
        includedCredits: 100000,
        lowBalanceAlertSent: true,
      };

      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);
      mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(
        existingSubscription
      );
      mockDb.query.invoices.findFirst.mockResolvedValueOnce(null); // No existing invoice
      mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(
        existingBalance
      );

      const result = await handleStripeWebhook(mockDb as never, validInput);

      expect(result.success).toBe(true);
      expect(mockDb.insert).toHaveBeenCalled(); // Should insert invoice and transaction
      expect(mockDb.update).toHaveBeenCalled(); // Should update balance
    });

    it('should update existing invoice record', async () => {
      const event = {
        id: 'evt_123',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'inv_123',
            customer: 'cus_abc123',
            amount_due: 4900,
            amount_paid: 4900,
            currency: 'usd',
            status: 'paid',
            billing_reason: 'subscription_create',
            status_transitions: {},
          },
        },
      };

      const existingSubscription = {
        id: 'sub_123',
        organizationId: 'org_123',
        stripeCustomerId: 'cus_abc123',
      };

      const existingInvoice = {
        id: 'inv_existing',
        stripeInvoiceId: 'inv_123',
      };

      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);
      mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(
        existingSubscription
      );
      mockDb.query.invoices.findFirst.mockResolvedValueOnce(existingInvoice);

      const result = await handleStripeWebhook(mockDb as never, validInput);

      expect(result.success).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('charge.refunded', () => {
    it('should process refund and add credits', async () => {
      const event = {
        id: 'evt_123',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_123',
            customer: 'cus_abc123',
            amount_refunded: 5000,
          },
        },
      };

      const existingSubscription = {
        id: 'sub_123',
        organizationId: 'org_123',
        stripeCustomerId: 'cus_abc123',
      };

      const existingBalance = {
        id: 'bal_123',
        organizationId: 'org_123',
        balance: 10000,
      };

      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);
      mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(
        existingSubscription
      );
      mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(
        existingBalance
      );

      const result = await handleStripeWebhook(mockDb as never, validInput);

      expect(result.success).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should handle refund when no subscription found', async () => {
      const event = {
        id: 'evt_123',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_123',
            customer: 'cus_unknown',
            amount_refunded: 5000,
          },
        },
      };

      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);
      mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(null);

      const result = await handleStripeWebhook(mockDb as never, validInput);

      // Should succeed but not update anything
      expect(result.success).toBe(true);
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('should handle refund when no credit balance found', async () => {
      const event = {
        id: 'evt_123',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_123',
            customer: 'cus_abc123',
            amount_refunded: 5000,
          },
        },
      };

      const existingSubscription = {
        id: 'sub_123',
        organizationId: 'org_123',
        stripeCustomerId: 'cus_abc123',
      };

      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);
      mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(
        existingSubscription
      );
      mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(null);

      const result = await handleStripeWebhook(mockDb as never, validInput);

      // Should succeed but not update anything
      expect(result.success).toBe(true);
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe('unhandled events', () => {
    it('should handle unknown event types gracefully', async () => {
      const event = {
        id: 'evt_123',
        type: 'payment_intent.created', // Unhandled event
        data: { object: {} },
      };

      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);

      const result = await handleStripeWebhook(mockDb as never, validInput);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.handled).toBe(true);
        expect(result.data.eventType).toBe('payment_intent.created');
      }
    });
  });

  describe('error handling', () => {
    it('should return INVALID_WEBHOOK_SIGNATURE for invalid signature', async () => {
      mockStripeService.constructWebhookEvent.mockImplementationOnce(() => {
        throw new Error(
          'No signatures found matching the expected signature for payload'
        );
      });

      await expectResult(
        handleStripeWebhook(mockDb as never, validInput)
      ).toFailWith((error) => {
        expect(error.code).toBe(BillingErrorCodes.INVALID_WEBHOOK_SIGNATURE);
        expect(error.message).toBe('Invalid webhook signature');
      });
    });

    it('should return STRIPE_WEBHOOK_ERROR for other Stripe errors', async () => {
      mockStripeService.constructWebhookEvent.mockImplementationOnce(() => {
        throw new Error('Some other Stripe error');
      });

      await expectResult(
        handleStripeWebhook(mockDb as never, validInput)
      ).toFailWith((error) => {
        expect(error.code).toBe(BillingErrorCodes.STRIPE_WEBHOOK_ERROR);
        expect(error.message).toBe('Failed to process webhook');
      });
    });

    it('should return VALIDATION_ERROR for missing payload', async () => {
      const invalidInput = {
        signature: 'whsec_valid',
      };

      await expectResult(
        handleStripeWebhook(mockDb as never, invalidInput as never)
      ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    });

    it('should return VALIDATION_ERROR for missing signature', async () => {
      const invalidInput = {
        payload: '{}',
      };

      await expectResult(
        handleStripeWebhook(mockDb as never, invalidInput as never)
      ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    });
  });

  describe('edge cases', () => {
    it('should handle checkout with missing organizationId in metadata', async () => {
      const event = {
        id: 'evt_123',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_123',
            customer: 'cus_abc123',
            subscription: 'sub_xyz789',
            metadata: {
              type: 'subscription',
              // Missing organizationId
            },
          },
        },
      };

      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);

      const result = await handleStripeWebhook(mockDb as never, validInput);

      // Should still succeed but not perform any operations
      expect(result.success).toBe(true);
    });

    it('should handle invoice with missing subscription', async () => {
      const event = {
        id: 'evt_123',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'inv_123',
            customer: 'cus_unknown',
            amount_due: 4900,
            amount_paid: 4900,
            currency: 'usd',
            status: 'paid',
          },
        },
      };

      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);
      mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(null);

      const result = await handleStripeWebhook(mockDb as never, validInput);

      // Should still succeed, just log a warning
      expect(result.success).toBe(true);
    });
  });

  describe('idempotency (event dedupe)', () => {
    it('skips effects and returns duplicate when the event was already processed', async () => {
      const event = {
        id: 'evt_dupe',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_123',
            metadata: {
              organizationId: 'org_123',
              type: 'credits',
              credits: '50000',
            },
          },
        },
      };

      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);
      // Claim insert returns [] → row already existed → duplicate delivery.
      mockDb.returning.mockResolvedValueOnce([]);

      const result = await handleStripeWebhook(mockDb as never, validInput);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.duplicate).toBe(true);
        expect(result.data.eventId).toBe('evt_dupe');
      }
      // No credit balance lookup / mutation should have happened.
      expect(mockDb.query.creditBalances.findFirst).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('claims the event before applying effects (single processing)', async () => {
      const event = {
        id: 'evt_123',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_123',
            metadata: {
              organizationId: 'org_123',
              type: 'credits',
              credits: '50000',
            },
          },
        },
      };

      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);
      mockDb.query.creditBalances.findFirst.mockResolvedValueOnce({
        id: 'bal_123',
        organizationId: 'org_123',
        balance: 10000,
      });

      const result = await handleStripeWebhook(mockDb as never, validInput);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.duplicate).toBeUndefined();
      // First insert is the idempotency claim into processed_webhook_event.
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('charge.refunded — partial refund delta', () => {
    it('credits only the DELTA when part of the charge was already refunded', async () => {
      const event = {
        id: 'evt_partial_2',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_partial',
            customer: 'cus_abc123',
            // Cumulative amount refunded across BOTH partial refunds.
            amount_refunded: 5000,
          },
        },
      };

      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);
      mockDb.query.subscriptions.findFirst.mockResolvedValueOnce({
        id: 'sub_123',
        organizationId: 'org_123',
        stripeCustomerId: 'cus_abc123',
      });
      mockDb.query.creditBalances.findFirst.mockResolvedValueOnce({
        id: 'bal_123',
        organizationId: 'org_123',
        balance: 10000,
      });
      // A prior partial refund of 3000 was already credited for this charge.
      mockDb.query.creditTransactions.findMany.mockResolvedValueOnce([
        { amount: 3000 },
      ]);

      const result = await handleStripeWebhook(mockDb as never, validInput);

      expect(result.success).toBe(true);
      // balance 10000 + delta (5000 - 3000 = 2000) = 12000
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ balance: 12000 })
      );
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'refund', amount: 2000 })
      );
    });

    it('no-ops when the full refund was already credited', async () => {
      const event = {
        id: 'evt_partial_dupe',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_partial',
            customer: 'cus_abc123',
            amount_refunded: 5000,
          },
        },
      };

      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);
      mockDb.query.subscriptions.findFirst.mockResolvedValueOnce({
        id: 'sub_123',
        organizationId: 'org_123',
        stripeCustomerId: 'cus_abc123',
      });
      mockDb.query.creditBalances.findFirst.mockResolvedValueOnce({
        id: 'bal_123',
        organizationId: 'org_123',
        balance: 10000,
      });
      // Already credited the full 5000.
      mockDb.query.creditTransactions.findMany.mockResolvedValueOnce([
        { amount: 5000 },
      ]);

      const result = await handleStripeWebhook(mockDb as never, validInput);

      expect(result.success).toBe(true);
      // No balance mutation — delta is 0.
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe('retryable vs poison classification', () => {
    it('returns WEBHOOK_TRANSIENT_ERROR for a transient DB failure', async () => {
      const event = {
        id: 'evt_transient',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_123',
            metadata: {
              organizationId: 'org_123',
              type: 'credits',
              credits: '50000',
            },
          },
        },
      };

      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);
      // The claim insert throws a transient connection error.
      const transient = Object.assign(new Error('Connection terminated'), {
        code: 'CONNECTION_CLOSED',
      });
      mockDb.returning.mockRejectedValueOnce(transient);

      await expectResult(
        handleStripeWebhook(mockDb as never, validInput)
      ).toFailWithCode(BillingErrorCodes.WEBHOOK_TRANSIENT_ERROR);
    });
  });
});
