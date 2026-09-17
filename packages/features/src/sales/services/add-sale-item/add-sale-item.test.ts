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
import { addSaleItem } from './add-sale-item.service.js';

describe('addSaleItem', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const openSale = {
    id: 'sale_1',
    organizationId: 'org_123',
    status: 'open',
    tipType: 'none',
    tipPercent: null,
    tipCents: 0,
    items: [],
    payments: [],
  };

  const validInput = {
    organizationId: 'org_123',
    saleId: 'sale_1',
    itemType: 'service' as const,
    serviceId: 'svc_1',
    name: 'Haircut',
    quantity: 2,
    unitPriceCents: 2500,
  };

  it('adds an item and recomputes totals', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce(openSale);
    mockDb.query.saleItem.findMany.mockResolvedValueOnce([
      { totalCents: 5000 },
    ]);
    mockDb.returning.mockResolvedValueOnce([
      { ...openSale, subtotalCents: 5000, totalCents: 5000 },
    ]);
    mockDb.query.salePayment.findMany.mockResolvedValueOnce([]);

    await expectResult(addSaleItem(mockDb as never, validInput)).toSucceedWith(
      (data) => {
        expect(data.subtotalCents).toBe(5000);
        expect(data.items).toHaveLength(1);
      }
    );
    const inserted = mockDb.values.mock.calls[0][0];
    expect(inserted.totalCents).toBe(5000);
  });

  it('preserves the lead relation after recomputing totals', async () => {
    const lead = { id: 'lead_1', firstName: 'Asdf', lastName: 'Asdf' };
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      ...openSale,
      leadId: 'lead_1',
      lead,
    });
    mockDb.query.saleItem.findMany.mockResolvedValueOnce([
      { totalCents: 5000 },
    ]);
    // .returning() yields the bare sale row — no relations
    mockDb.returning.mockResolvedValueOnce([
      { ...openSale, leadId: 'lead_1', subtotalCents: 5000, totalCents: 5000 },
    ]);
    mockDb.query.salePayment.findMany.mockResolvedValueOnce([]);

    await expectResult(addSaleItem(mockDb as never, validInput)).toSucceedWith(
      (data) => {
        expect(data.lead).toEqual(lead);
      }
    );
  });

  it('rejects items on a non-open sale', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      ...openSale,
      status: 'completed',
    });
    const result = await addSaleItem(mockDb as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('returns NOT_FOUND when the sale is missing', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce(undefined);
    const result = await addSaleItem(mockDb as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR when the polymorphic FK does not match itemType', async () => {
    const result = await addSaleItem(mockDb as never, {
      ...validInput,
      itemType: 'product' as const,
      // serviceId is set but itemType is product
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('rejects entity references on gift_card lines', async () => {
    const result = await addSaleItem(mockDb as never, {
      ...validInput,
      itemType: 'gift_card' as const,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('rejects a membership line on a lead-less (walk-in) sale (M2)', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      ...openSale,
      leadId: null,
    });
    const result = await addSaleItem(mockDb as never, {
      organizationId: 'org_123',
      saleId: 'sale_1',
      itemType: 'membership' as const,
      membershipPlanId: 'plan_1',
      name: 'Gold Membership',
      quantity: 1,
      unitPriceCents: 10000,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    // No insert attempted.
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('allows a membership line when the sale has a client', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      ...openSale,
      leadId: 'lead_1',
    });
    // The line price must match the plan price.
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce({
      id: 'plan_1',
      organizationId: 'org_123',
      priceCents: 10000,
    });
    mockDb.query.saleItem.findMany.mockResolvedValueOnce([
      { totalCents: 10000 },
    ]);
    mockDb.returning.mockResolvedValueOnce([
      {
        ...openSale,
        leadId: 'lead_1',
        subtotalCents: 10000,
        totalCents: 10000,
      },
    ]);
    mockDb.query.salePayment.findMany.mockResolvedValueOnce([]);

    const result = await addSaleItem(mockDb as never, {
      organizationId: 'org_123',
      saleId: 'sale_1',
      itemType: 'membership' as const,
      membershipPlanId: 'plan_1',
      name: 'Gold Membership',
      quantity: 1,
      unitPriceCents: 10000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a membership line whose price does not match the plan', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      ...openSale,
      leadId: 'lead_1',
    });
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce({
      id: 'plan_1',
      organizationId: 'org_123',
      priceCents: 10000,
    });

    const result = await addSaleItem(mockDb as never, {
      organizationId: 'org_123',
      saleId: 'sale_1',
      itemType: 'membership' as const,
      membershipPlanId: 'plan_1',
      name: 'Gold Membership',
      quantity: 1,
      unitPriceCents: 9000, // does not match plan.priceCents
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('rejects a membership line with quantity > 1', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      ...openSale,
      leadId: 'lead_1',
    });

    const result = await addSaleItem(mockDb as never, {
      organizationId: 'org_123',
      saleId: 'sale_1',
      itemType: 'membership' as const,
      membershipPlanId: 'plan_1',
      name: 'Gold Membership',
      quantity: 2,
      unitPriceCents: 10000,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.sale.findFirst.mockRejectedValueOnce(new Error('DB failed'));
    const result = await addSaleItem(mockDb as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
