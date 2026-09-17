import { describe, expect, it } from 'vitest';
import {
  adjustProductStockRequestSchema,
  createProductBrandRequestSchema,
  createProductCategoryRequestSchema,
  createProductRequestSchema,
  createStockOrderRequestSchema,
  createSupplierRequestSchema,
  receiveStockOrderRequestSchema,
  recordStockTakeCountsRequestSchema,
  updateProductRequestSchema,
} from './inventory.js';

describe('createProductBrandRequestSchema', () => {
  it('accepts the full dialog body', () => {
    expect(
      createProductBrandRequestSchema.safeParse({
        name: 'Olaplex',
        description: 'Bond builder',
      }).success
    ).toBe(true);
  });

  it('accepts the inline quick-create body (description null)', () => {
    expect(
      createProductBrandRequestSchema.safeParse({
        name: 'Olaplex',
        description: null,
      }).success
    ).toBe(true);
  });

  it('rejects a blank name', () => {
    expect(
      createProductBrandRequestSchema.safeParse({ name: '' }).success
    ).toBe(false);
  });

  it('REJECTS a body with an unknown / extra field (proves .strict())', () => {
    const result = createProductBrandRequestSchema.safeParse({
      name: 'Olaplex',
      // server-injected; must never appear in the body
      organizationId: 'org_1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.code === 'unrecognized_keys')
      ).toBe(true);
    }
  });
});

describe('createProductCategoryRequestSchema', () => {
  it('accepts a name-only body', () => {
    expect(
      createProductCategoryRequestSchema.safeParse({ name: 'Shampoo' }).success
    ).toBe(true);
  });

  it('rejects a description it does not declare', () => {
    expect(
      createProductCategoryRequestSchema.safeParse({
        name: 'Shampoo',
        description: 'nope',
      }).success
    ).toBe(false);
  });
});

describe('createSupplierRequestSchema', () => {
  it('accepts a supplier body', () => {
    expect(
      createSupplierRequestSchema.safeParse({
        name: 'Salon Supplies Ltd',
        description: null,
      }).success
    ).toBe(true);
  });

  it('rejects a blank name', () => {
    expect(createSupplierRequestSchema.safeParse({ name: '' }).success).toBe(
      false
    );
  });
});

describe('createProductRequestSchema', () => {
  const minimal = { name: 'Shampoo 250ml' };

  it('accepts a name-only body and MATERIALISES every default', () => {
    const result = createProductRequestSchema.parse(minimal);
    expect(result).toEqual({
      name: 'Shampoo 250ml',
      measureUnit: 'whole',
      retailEnabled: false,
      isMedication: false,
      onlineEnabled: false,
      shippable: true,
      teamMemberCommissionEnabled: false,
      trackStock: false,
      lowStockNotify: false,
    });
  });

  it('accepts the full body the product form builds', () => {
    const result = createProductRequestSchema.safeParse({
      name: 'Shampoo 250ml',
      images: ['https://cdn.example.com/a.jpg'],
      barcode: null,
      brandId: 'brand_1',
      measureUnit: 'ml',
      measureAmount: 250,
      shortDescription: null,
      description: null,
      categoryId: 'cat_1',
      supplyPriceCents: 450,
      retailEnabled: true,
      retailPriceCents: 1200,
      taxCode: 'txcd_99999999',
      teamMemberCommissionEnabled: true,
      skus: ['SKU-1'],
      supplierId: 'sup_1',
      trackStock: true,
      lowStockLevel: 3,
      reorderQuantity: 10,
      lowStockNotify: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a Stripe tax-code override or an explicit return to the clinic default', () => {
    expect(
      createProductRequestSchema.safeParse({
        ...minimal,
        taxCode: 'txcd_99999999',
      }).success
    ).toBe(true);
    expect(
      updateProductRequestSchema.safeParse({ taxCode: null }).success
    ).toBe(true);
    expect(
      createProductRequestSchema.safeParse({ ...minimal, taxCode: '' }).success
    ).toBe(false);
  });

  it('rejects a fractional price — cents are INTEGER minor units', () => {
    expect(
      createProductRequestSchema.safeParse({
        ...minimal,
        supplyPriceCents: 4.5,
      }).success
    ).toBe(false);
  });

  it('rejects a non-positive measureAmount', () => {
    expect(
      createProductRequestSchema.safeParse({ ...minimal, measureAmount: 0 })
        .success
    ).toBe(false);
  });

  it('rejects reorderQuantity 0 (a zero-unit reorder is meaningless)', () => {
    expect(
      createProductRequestSchema.safeParse({ ...minimal, reorderQuantity: 0 })
        .success
    ).toBe(false);
  });

  it('accepts lowStockLevel 0 (a zero threshold is meaningful)', () => {
    expect(
      createProductRequestSchema.safeParse({ ...minimal, lowStockLevel: 0 })
        .success
    ).toBe(true);
  });

  it('rejects an unknown measure unit', () => {
    expect(
      createProductRequestSchema.safeParse({
        ...minimal,
        measureUnit: 'furlong',
      }).success
    ).toBe(false);
  });

  it('rejects the update-only isActive field', () => {
    expect(
      createProductRequestSchema.safeParse({ ...minimal, isActive: false })
        .success
    ).toBe(false);
  });

  it('REJECTS a body with server-injected organizationId', () => {
    expect(
      createProductRequestSchema.safeParse({ ...minimal, organizationId: 'o1' })
        .success
    ).toBe(false);
  });
});

describe('updateProductRequestSchema', () => {
  it('accepts an empty body (every field optional)', () => {
    expect(updateProductRequestSchema.safeParse({}).success).toBe(true);
  });

  it('applies no defaults — an omitted field stays omitted', () => {
    expect(updateProductRequestSchema.parse({})).toEqual({});
  });

  it('accepts nulled collections (clearing images / skus)', () => {
    expect(
      updateProductRequestSchema.safeParse({ images: null, skus: null }).success
    ).toBe(true);
  });

  it('accepts isActive', () => {
    expect(
      updateProductRequestSchema.safeParse({ isActive: false }).success
    ).toBe(true);
  });

  it('accepts every body the create contract accepts (create ⊆ update)', () => {
    // The frontend validates BOTH verbs against the create contract, which is
    // only sound while a create-valid body stays update-valid.
    const created = createProductRequestSchema.parse({
      name: 'Shampoo 250ml',
      measureAmount: 250,
      supplyPriceCents: 450,
    });
    expect(updateProductRequestSchema.safeParse(created).success).toBe(true);
  });

  it('rejects the route-param id in the body', () => {
    expect(updateProductRequestSchema.safeParse({ id: 'prod_1' }).success).toBe(
      false
    );
  });
});

describe('adjustProductStockRequestSchema', () => {
  it('accepts an absolute quantity of 0', () => {
    expect(
      adjustProductStockRequestSchema.safeParse({ quantity: 0 }).success
    ).toBe(true);
  });

  it('rejects a negative quantity', () => {
    expect(
      adjustProductStockRequestSchema.safeParse({ quantity: -1 }).success
    ).toBe(false);
  });

  it('rejects the route params in the body', () => {
    expect(
      adjustProductStockRequestSchema.safeParse({
        quantity: 5,
        productId: 'p1',
        locationId: 'l1',
      }).success
    ).toBe(false);
  });
});

describe('createStockOrderRequestSchema', () => {
  const minimal = { items: [{ productId: 'p1', quantity: 2 }] };

  it('accepts a minimal order and materialises the unitCostCents / fees defaults', () => {
    expect(createStockOrderRequestSchema.parse(minimal)).toEqual({
      items: [{ productId: 'p1', quantity: 2, unitCostCents: 0 }],
      fees: [],
    });
  });

  it('coerces an ISO expectedByDate off the wire into a Date', () => {
    const parsed = createStockOrderRequestSchema.parse({
      ...minimal,
      expectedByDate: '2024-03-01T00:00:00.000Z',
    });
    expect(parsed.expectedByDate).toBeInstanceOf(Date);
  });

  it('accepts a Date for expectedByDate (what the frontend builder holds)', () => {
    const parsed = createStockOrderRequestSchema.parse({
      ...minimal,
      expectedByDate: new Date('2024-03-01T00:00:00.000Z'),
    });
    expect(parsed.expectedByDate).toBeInstanceOf(Date);
  });

  it('rejects an order with no items', () => {
    expect(createStockOrderRequestSchema.safeParse({ items: [] }).success).toBe(
      false
    );
  });

  it('rejects a zero-quantity line (that is an omission, not a line)', () => {
    expect(
      createStockOrderRequestSchema.safeParse({
        items: [{ productId: 'p1', quantity: 0 }],
      }).success
    ).toBe(false);
  });

  it('accepts both fee types with integer values (cents / basis points)', () => {
    expect(
      createStockOrderRequestSchema.safeParse({
        ...minimal,
        fees: [
          { name: 'Shipping', type: 'currency', value: 1500 },
          { name: 'Handling', type: 'percent', value: 250 },
        ],
      }).success
    ).toBe(true);
  });

  it('rejects a fractional fee value — both units are INTEGER', () => {
    expect(
      createStockOrderRequestSchema.safeParse({
        ...minimal,
        fees: [{ name: 'Handling', type: 'percent', value: 2.5 }],
      }).success
    ).toBe(false);
  });

  it('REJECTS the server-injected createdById', () => {
    expect(
      createStockOrderRequestSchema.safeParse({
        ...minimal,
        createdById: 'user_1',
      }).success
    ).toBe(false);
  });
});

describe('receiveStockOrderRequestSchema', () => {
  it('accepts delta quantities, including 0 on a line', () => {
    expect(
      receiveStockOrderRequestSchema.safeParse({
        items: [{ itemId: 'i1', receivedQuantity: 0 }],
      }).success
    ).toBe(true);
  });

  it('rejects an empty items array', () => {
    expect(
      receiveStockOrderRequestSchema.safeParse({ items: [] }).success
    ).toBe(false);
  });

  it('rejects the route-param stockOrderId in the body', () => {
    expect(
      receiveStockOrderRequestSchema.safeParse({
        items: [{ itemId: 'i1', receivedQuantity: 1 }],
        stockOrderId: 'so_1',
      }).success
    ).toBe(false);
  });
});

describe('recordStockTakeCountsRequestSchema', () => {
  it('accepts a counted quantity of 0 ("we counted none" is a real result)', () => {
    expect(
      recordStockTakeCountsRequestSchema.safeParse({
        items: [{ itemId: 'i1', countedQuantity: 0 }],
      }).success
    ).toBe(true);
  });

  it('rejects an empty items array', () => {
    expect(
      recordStockTakeCountsRequestSchema.safeParse({ items: [] }).success
    ).toBe(false);
  });

  it('rejects a fractional count', () => {
    expect(
      recordStockTakeCountsRequestSchema.safeParse({
        items: [{ itemId: 'i1', countedQuantity: 1.5 }],
      }).success
    ).toBe(false);
  });
});
