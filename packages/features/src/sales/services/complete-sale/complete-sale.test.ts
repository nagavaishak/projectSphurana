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
import { completeSale } from './complete-sale.service.js';

describe('completeSale', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const paidSale = {
    id: 'sale_1',
    organizationId: 'org_123',
    status: 'open',
    currency: 'eur',
    leadId: 'lead_1',
    totalCents: 5000,
    items: [
      { id: 'item_1', itemType: 'service', totalCents: 5000, giftCardId: null },
    ],
    payments: [{ id: 'pay_1', status: 'succeeded', amountCents: 5000 }],
  };

  const validInput = { organizationId: 'org_123', saleId: 'sale_1' };

  it('completes a fully paid sale', async () => {
    // Two reads: the preflight validation load + the in-transaction load.
    mockDb.query.sale.findFirst.mockResolvedValue(paidSale);
    mockDb.returning.mockResolvedValueOnce([
      { ...paidSale, status: 'completed', completedAt: new Date() },
    ]);

    await expectResult(completeSale(mockDb as never, validInput)).toSucceedWith(
      (data) => {
        expect(data.status).toBe('completed');
      }
    );
  });

  it('issues gift cards for gift_card line items', async () => {
    mockDb.query.sale.findFirst.mockResolvedValue({
      ...paidSale,
      items: [
        {
          id: 'item_1',
          itemType: 'gift_card',
          totalCents: 5000,
          giftCardId: null,
        },
      ],
    });
    // gift card insert returning, then sale update returning
    mockDb.returning
      .mockResolvedValueOnce([
        { id: 'gc_1', code: 'GC-AAAA-BBBB-CCCC', balanceCents: 5000 },
      ])
      .mockResolvedValueOnce([{ ...paidSale, status: 'completed' }]);

    await expectResult(completeSale(mockDb as never, validInput)).toSucceedWith(
      (data) => {
        expect(data.status).toBe('completed');
      }
    );

    const inserts = mockDb.values.mock.calls.map((call) => call[0]);
    // First insert: the gift card itself
    expect(inserts[0].initialAmountCents).toBe(5000);
    expect(inserts[0].balanceCents).toBe(5000);
    expect(inserts[0].code).toMatch(
      /^GC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/
    );
    expect(inserts[0].leadId).toBe('lead_1');
    expect(inserts[0].saleItemId).toBe('item_1');
    // Second insert: the issue ledger row (positive, sums to balance)
    expect(inserts[1].type).toBe('issue');
    expect(inserts[1].amountCents).toBe(5000);
    expect(inserts[1].giftCardId).toBe('gc_1');
  });

  it('issues the FACE VALUE, not the discounted price, and honors a per-card expiry', async () => {
    // A €50 card sold for €20 (a €30 manual discount): the sale line total is
    // 2000, but the card must be issued at its 5000 face value. The line's own
    // expiry override ('never') wins over the org default.
    mockDb.query.sale.findFirst.mockResolvedValue({
      ...paidSale,
      items: [
        {
          id: 'item_1',
          itemType: 'gift_card',
          totalCents: 2000,
          giftCardFaceValueCents: 5000,
          giftCardExpiry: 'never',
          giftCardId: null,
        },
      ],
    });
    // Org default would expire; the per-card 'never' override must win → null.
    mockDb.query.orgDefaults.findFirst.mockResolvedValueOnce({
      organizationId: 'org_123',
      giftCardExpiry: '1m',
    });
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'gc_1', balanceCents: 5000 }])
      .mockResolvedValueOnce([{ ...paidSale, status: 'completed' }]);

    await expectResult(completeSale(mockDb as never, validInput)).toSucceedWith(
      (data) => expect(data.status).toBe('completed')
    );

    const inserts = mockDb.values.mock.calls.map((call) => call[0]);
    // The card carries the face value, not the price paid.
    expect(inserts[0].initialAmountCents).toBe(5000);
    expect(inserts[0].balanceCents).toBe(5000);
    // Per-card 'never' override → no expiry.
    expect(inserts[0].expiresAt).toBeNull();
    // The issue ledger row matches the face value.
    expect(inserts[1].type).toBe('issue');
    expect(inserts[1].amountCents).toBe(5000);
  });

  it('recovers from a gift card code collision (L3)', async () => {
    mockDb.query.sale.findFirst.mockResolvedValue({
      ...paidSale,
      items: [
        {
          id: 'item_1',
          itemType: 'gift_card',
          totalCents: 5000,
          giftCardId: null,
        },
      ],
    });
    // First generated code collides with an existing card, second is free.
    mockDb.query.giftCard.findFirst
      .mockResolvedValueOnce({ id: 'gc_existing', code: 'GC-COLL-ISIO-NNNN' })
      .mockResolvedValueOnce(null);
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'gc_1', balanceCents: 5000 }])
      .mockResolvedValueOnce([{ ...paidSale, status: 'completed' }]);

    await expectResult(completeSale(mockDb as never, validInput)).toSucceedWith(
      (data) => expect(data.status).toBe('completed')
    );

    // The collision forced a second code lookup before the insert succeeded.
    expect(mockDb.query.giftCard.findFirst).toHaveBeenCalledTimes(2);
    // Exactly one gift card was inserted (no aborted-tx retry).
    const giftCardInserts = mockDb.values.mock.calls
      .map((call) => call[0])
      .filter((v) => v.initialAmountCents === 5000);
    expect(giftCardInserts).toHaveLength(1);
  });

  it('derives gift card expiry from org_defaults.gift_card_expiry', async () => {
    mockDb.query.sale.findFirst.mockResolvedValue({
      ...paidSale,
      items: [
        {
          id: 'item_1',
          itemType: 'gift_card',
          totalCents: 5000,
          giftCardId: null,
        },
      ],
    });
    // Org has a 1-month gift card expiry configured.
    mockDb.query.orgDefaults.findFirst.mockResolvedValueOnce({
      organizationId: 'org_123',
      giftCardExpiry: '1m',
    });
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'gc_1', balanceCents: 5000 }])
      .mockResolvedValueOnce([{ ...paidSale, status: 'completed' }]);

    await expectResult(completeSale(mockDb as never, validInput)).toSucceedWith(
      (data) => expect(data.status).toBe('completed')
    );

    const giftCardInsert = mockDb.values.mock.calls
      .map((call) => call[0])
      .find((v) => v.initialAmountCents === 5000);
    expect(giftCardInsert.expiresAt).toBeInstanceOf(Date);
  });

  it('provisions a lead_membership with saleItemId provenance', async () => {
    mockDb.query.sale.findFirst.mockResolvedValue({
      ...paidSale,
      items: [
        {
          id: 'item_m',
          itemType: 'membership',
          membershipPlanId: 'plan_1',
          totalCents: 5000,
          giftCardId: null,
        },
      ],
    });
    // completeSale txn: only the sale update returns.
    mockDb.returning.mockResolvedValueOnce([
      { ...paidSale, status: 'completed' },
    ]);
    // purchaseMembership (one_time): plan lookup, lead lookup, then insert.
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce({
      id: 'plan_1',
      organizationId: 'org_123',
      pricingType: 'one_time',
      validFor: '1m',
      sessionCount: null,
      isActive: true,
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead_1',
      organizationId: 'org_123',
      email: 'client@example.com',
      firstName: 'Ann',
      lastName: 'Lee',
    });
    mockDb.returning.mockResolvedValueOnce([
      { id: 'lm_1', saleItemId: 'item_m' },
    ]);

    await expectResult(completeSale(mockDb as never, validInput)).toSucceedWith(
      (data) => expect(data.status).toBe('completed')
    );

    const membershipInsert = mockDb.values.mock.calls
      .map((call) => call[0])
      .find((v) => v.planId === 'plan_1');
    expect(membershipInsert).toBeDefined();
    expect(membershipInsert.saleItemId).toBe('item_m');
    expect(membershipInsert.leadId).toBe('lead_1');
  });

  it('decrements product stock for tracked product lines at completion', async () => {
    mockDb.query.sale.findFirst.mockResolvedValue({
      ...paidSale,
      locationId: 'loc_1',
      items: [
        {
          id: 'item_p',
          itemType: 'product',
          productId: 'prod_1',
          quantity: 2,
          totalCents: 5000,
          giftCardId: null,
        },
      ],
    });
    // Product is tracked, so its stock moves.
    mockDb.query.product.findMany.mockResolvedValueOnce([
      { id: 'prod_1', trackStock: true },
    ]);
    mockDb.returning.mockResolvedValueOnce([
      { ...paidSale, status: 'completed' },
    ]);

    await expectResult(completeSale(mockDb as never, validInput)).toSucceedWith(
      (data) => expect(data.status).toBe('completed')
    );

    // The stock decrement is an upsert on product_stock.
    expect(mockDb.onConflictDoUpdate).toHaveBeenCalled();
    const stockInsert = mockDb.values.mock.calls
      .map((call) => call[0])
      .find((v) => v.productId === 'prod_1' && v.locationId === 'loc_1');
    expect(stockInsert).toBeDefined();
    expect(stockInsert.quantity).toBe(-2);
  });

  it('rejects completing an unpaid sale', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      ...paidSale,
      payments: [{ id: 'pay_1', status: 'pending', amountCents: 5000 }],
    });
    const result = await completeSale(mockDb as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('rejects completing a non-open sale', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      ...paidSale,
      status: 'completed',
    });
    const result = await completeSale(mockDb as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('returns NOT_FOUND when the sale is missing', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce(undefined);
    const result = await completeSale(mockDb as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });
});
