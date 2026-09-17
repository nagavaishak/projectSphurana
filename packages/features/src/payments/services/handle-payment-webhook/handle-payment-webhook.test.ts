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
import { handlePaymentWebhook } from './handle-payment-webhook.service.js';

describe('handlePaymentWebhook', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const pendingPayment = {
    id: 'pay_123',
    status: 'pending',
    stripeCheckoutSessionId: 'cs_123',
    stripePaymentIntentId: null,
  };

  const paidPayment = {
    id: 'pay_123',
    status: 'paid',
    stripeCheckoutSessionId: 'cs_123',
    stripePaymentIntentId: 'pi_456',
  };

  describe('checkout.session.completed', () => {
    it('should mark pending payment as paid', async () => {
      mockDb.query.payment.findFirst.mockResolvedValueOnce(pendingPayment);
      mockDb.set.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(undefined);

      await expectResult(
        handlePaymentWebhook(mockDb as never, {
          eventType: 'checkout.session.completed',
          checkoutSessionId: 'cs_123',
          paymentIntentId: 'pi_456',
        })
      ).toSucceedWith((data) => {
        expect(data.processed).toBe(true);
        expect(data.paymentId).toBe('pay_123');
        expect(data.action).toBe('paid');
      });
    });

    it('should ignore if no checkoutSessionId', async () => {
      await expectResult(
        handlePaymentWebhook(mockDb as never, {
          eventType: 'checkout.session.completed',
        })
      ).toSucceedWith((data) => {
        expect(data.processed).toBe(false);
        expect(data.action).toBe('ignored');
      });
    });

    it('should ignore if payment not found', async () => {
      mockDb.query.payment.findFirst.mockResolvedValueOnce(null);

      await expectResult(
        handlePaymentWebhook(mockDb as never, {
          eventType: 'checkout.session.completed',
          checkoutSessionId: 'cs_unknown',
        })
      ).toSucceedWith((data) => {
        expect(data.processed).toBe(false);
        expect(data.action).toBe('ignored');
      });
    });

    it('should ignore if payment is not pending', async () => {
      mockDb.query.payment.findFirst.mockResolvedValueOnce(paidPayment);

      await expectResult(
        handlePaymentWebhook(mockDb as never, {
          eventType: 'checkout.session.completed',
          checkoutSessionId: 'cs_123',
        })
      ).toSucceedWith((data) => {
        expect(data.processed).toBe(false);
        expect(data.paymentId).toBe('pay_123');
        expect(data.action).toBe('ignored');
      });
    });
  });

  describe('checkout.session.expired', () => {
    it('should mark pending payment as expired', async () => {
      mockDb.query.payment.findFirst.mockResolvedValueOnce(pendingPayment);
      mockDb.set.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(undefined);

      await expectResult(
        handlePaymentWebhook(mockDb as never, {
          eventType: 'checkout.session.expired',
          checkoutSessionId: 'cs_123',
        })
      ).toSucceedWith((data) => {
        expect(data.processed).toBe(true);
        expect(data.paymentId).toBe('pay_123');
        expect(data.action).toBe('expired');
      });
    });

    it('should ignore if no checkoutSessionId', async () => {
      await expectResult(
        handlePaymentWebhook(mockDb as never, {
          eventType: 'checkout.session.expired',
        })
      ).toSucceedWith((data) => {
        expect(data.processed).toBe(false);
        expect(data.action).toBe('ignored');
      });
    });

    it('should ignore if payment not found', async () => {
      mockDb.query.payment.findFirst.mockResolvedValueOnce(null);

      await expectResult(
        handlePaymentWebhook(mockDb as never, {
          eventType: 'checkout.session.expired',
          checkoutSessionId: 'cs_unknown',
        })
      ).toSucceedWith((data) => {
        expect(data.processed).toBe(false);
        expect(data.action).toBe('ignored');
      });
    });

    it('should ignore if payment already paid', async () => {
      mockDb.query.payment.findFirst.mockResolvedValueOnce(paidPayment);

      await expectResult(
        handlePaymentWebhook(mockDb as never, {
          eventType: 'checkout.session.expired',
          checkoutSessionId: 'cs_123',
        })
      ).toSucceedWith((data) => {
        expect(data.processed).toBe(false);
        expect(data.action).toBe('ignored');
      });
    });
  });

  describe('charge.refunded', () => {
    it('should mark paid payment as refunded', async () => {
      mockDb.query.payment.findFirst.mockResolvedValueOnce(paidPayment);
      mockDb.set.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(undefined);

      await expectResult(
        handlePaymentWebhook(mockDb as never, {
          eventType: 'charge.refunded',
          paymentIntentId: 'pi_456',
        })
      ).toSucceedWith((data) => {
        expect(data.processed).toBe(true);
        expect(data.paymentId).toBe('pay_123');
        expect(data.action).toBe('refunded');
      });
    });

    it('should ignore if no paymentIntentId', async () => {
      await expectResult(
        handlePaymentWebhook(mockDb as never, {
          eventType: 'charge.refunded',
        })
      ).toSucceedWith((data) => {
        expect(data.processed).toBe(false);
        expect(data.action).toBe('ignored');
      });
    });

    it('should ignore if payment not found', async () => {
      mockDb.query.payment.findFirst.mockResolvedValueOnce(null);

      await expectResult(
        handlePaymentWebhook(mockDb as never, {
          eventType: 'charge.refunded',
          paymentIntentId: 'pi_unknown',
        })
      ).toSucceedWith((data) => {
        expect(data.processed).toBe(false);
        expect(data.action).toBe('ignored');
      });
    });

    it('should ignore if payment already refunded', async () => {
      mockDb.query.payment.findFirst.mockResolvedValueOnce({
        ...paidPayment,
        status: 'refunded',
      });

      await expectResult(
        handlePaymentWebhook(mockDb as never, {
          eventType: 'charge.refunded',
          paymentIntentId: 'pi_456',
        })
      ).toSucceedWith((data) => {
        expect(data.processed).toBe(false);
        expect(data.paymentId).toBe('pay_123');
        expect(data.action).toBe('ignored');
      });
    });
  });

  it('should return VALIDATION_ERROR for invalid eventType', async () => {
    await expectResult(
      handlePaymentWebhook(mockDb as never, {
        eventType: 'invalid.event' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should propagate DB failure as rejection', async () => {
    mockDb.query.payment.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expect(
      handlePaymentWebhook(mockDb as never, {
        eventType: 'checkout.session.completed',
        checkoutSessionId: 'cs_123',
      })
    ).rejects.toThrow('DB failed');
  });
});
