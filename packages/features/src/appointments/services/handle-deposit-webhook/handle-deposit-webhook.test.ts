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
import { handleDepositWebhook } from './handle-deposit-webhook.service.js';

// The webhook handlers lock the deposit row (SELECT … FOR UPDATE) inside a
// transaction, so the mock's terminal `.limit()` on the select chain is where
// the row is returned (an array), not `db.query.appointmentDeposit.findFirst`.
describe('handleDepositWebhook', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const pendingDeposit = {
    id: 'dep_123',
    appointmentId: 'appt_123',
    organizationId: 'org_123',
    status: 'pending',
    stripeCheckoutSessionId: 'cs_123',
    stripePaymentIntentId: null,
    stripeConnectedAccountId: 'acct_123',
    amountCents: 5000,
  };

  const paidDeposit = {
    ...pendingDeposit,
    status: 'paid',
    stripePaymentIntentId: 'pi_123',
  };

  /** Mock the locked-select result for the next handler invocation. */
  const mockLockedDeposit = (deposit: unknown | null) => {
    mockDb.limit.mockResolvedValueOnce(deposit ? [deposit] : []);
  };

  // ---- checkout.session.completed ----

  describe('checkout.session.completed', () => {
    it('should mark deposit as paid', async () => {
      mockLockedDeposit(pendingDeposit);

      const result = await handleDepositWebhook(mockDb as never, {
        eventType: 'checkout.session.completed',
        checkoutSessionId: 'cs_123',
        paymentIntentId: 'pi_123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processed).toBe(true);
        expect(result.data.depositId).toBe('dep_123');
        expect(result.data.action).toBe('paid');
      }
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should ignore when no checkoutSessionId provided', async () => {
      const result = await handleDepositWebhook(mockDb as never, {
        eventType: 'checkout.session.completed',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processed).toBe(false);
        expect(result.data.action).toBe('ignored');
      }
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('should ignore when deposit not found', async () => {
      mockLockedDeposit(null);

      const result = await handleDepositWebhook(mockDb as never, {
        eventType: 'checkout.session.completed',
        checkoutSessionId: 'cs_unknown',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processed).toBe(false);
        expect(result.data.action).toBe('ignored');
      }
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('should ignore when deposit is not pending', async () => {
      mockLockedDeposit(paidDeposit);

      const result = await handleDepositWebhook(mockDb as never, {
        eventType: 'checkout.session.completed',
        checkoutSessionId: 'cs_123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processed).toBe(false);
        expect(result.data.depositId).toBe('dep_123');
        expect(result.data.action).toBe('ignored');
      }
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  // ---- checkout.session.expired ----

  describe('checkout.session.expired', () => {
    it('should mark deposit as expired and update appointment', async () => {
      mockLockedDeposit(pendingDeposit);

      const result = await handleDepositWebhook(mockDb as never, {
        eventType: 'checkout.session.expired',
        checkoutSessionId: 'cs_123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processed).toBe(true);
        expect(result.data.depositId).toBe('dep_123');
        expect(result.data.action).toBe('expired');
      }
      // Should update deposit + appointment = 2 calls
      expect(mockDb.update).toHaveBeenCalledTimes(2);
    });

    it('should ignore when no checkoutSessionId provided', async () => {
      const result = await handleDepositWebhook(mockDb as never, {
        eventType: 'checkout.session.expired',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processed).toBe(false);
        expect(result.data.action).toBe('ignored');
      }
    });

    it('should ignore when deposit not found', async () => {
      mockLockedDeposit(null);

      const result = await handleDepositWebhook(mockDb as never, {
        eventType: 'checkout.session.expired',
        checkoutSessionId: 'cs_unknown',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processed).toBe(false);
        expect(result.data.action).toBe('ignored');
      }
    });

    it('should ignore when deposit is not pending', async () => {
      mockLockedDeposit(paidDeposit);

      const result = await handleDepositWebhook(mockDb as never, {
        eventType: 'checkout.session.expired',
        checkoutSessionId: 'cs_123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processed).toBe(false);
        expect(result.data.action).toBe('ignored');
      }
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  // ---- charge.refunded ----

  describe('charge.refunded', () => {
    it('should mark deposit as refunded', async () => {
      mockLockedDeposit(paidDeposit);

      const result = await handleDepositWebhook(mockDb as never, {
        eventType: 'charge.refunded',
        paymentIntentId: 'pi_123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processed).toBe(true);
        expect(result.data.depositId).toBe('dep_123');
        expect(result.data.action).toBe('refunded');
      }
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should ignore when no paymentIntentId provided', async () => {
      const result = await handleDepositWebhook(mockDb as never, {
        eventType: 'charge.refunded',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processed).toBe(false);
        expect(result.data.action).toBe('ignored');
      }
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('should ignore when deposit not found', async () => {
      mockLockedDeposit(null);

      const result = await handleDepositWebhook(mockDb as never, {
        eventType: 'charge.refunded',
        paymentIntentId: 'pi_unknown',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processed).toBe(false);
        expect(result.data.action).toBe('ignored');
      }
    });

    it('should ignore when deposit is already refunded', async () => {
      const refundedDeposit = { ...paidDeposit, status: 'refunded' };
      mockLockedDeposit(refundedDeposit);

      const result = await handleDepositWebhook(mockDb as never, {
        eventType: 'charge.refunded',
        paymentIntentId: 'pi_123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processed).toBe(false);
        expect(result.data.depositId).toBe('dep_123');
        expect(result.data.action).toBe('ignored');
      }
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  // ---- General ----

  describe('general', () => {
    it('should return VALIDATION_ERROR for invalid eventType', async () => {
      await expectResult(
        handleDepositWebhook(mockDb as never, {
          eventType: 'invalid.event' as never,
        })
      ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    });

    it('should propagate database errors', async () => {
      // A DB failure in a handler rejects (the handler promise is returned, not
      // awaited inside the outer try), surfacing as a 5xx so Stripe retries.
      mockDb.limit.mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      await expect(
        handleDepositWebhook(mockDb as never, {
          eventType: 'checkout.session.completed',
          checkoutSessionId: 'cs_123',
        })
      ).rejects.toThrow('Database connection failed');
    });
  });
});
