import { describe, expect, it } from '@borradh-workspace/testing';
import { computeCartTotal } from './cart-total.js';

describe('computeCartTotal', () => {
  it('returns an EXACT total when every line is priced', () => {
    const total = computeCartTotal([
      { priceCents: 2500 },
      { priceCents: 1500 },
      { priceCents: 1000 },
    ]);

    expect(total).toEqual({
      totalCents: 5000,
      isExact: true,
      fromCents: 5000,
    });
  });

  it('returns a "from" total when at least one line is unpriced', () => {
    const total = computeCartTotal([
      { priceCents: 2500 },
      { priceCents: null },
      { priceCents: 1500 },
    ]);

    expect(total).toEqual({
      totalCents: null,
      isExact: false,
      fromCents: 4000,
    });
  });

  it('treats a missing priceCents field the same as null', () => {
    const total = computeCartTotal([{ priceCents: 2500 }, {}]);

    expect(total).toEqual({
      totalCents: null,
      isExact: false,
      fromCents: 2500,
    });
  });

  it('returns null fromCents when no line carries a price', () => {
    const total = computeCartTotal([
      { priceCents: null },
      { priceCents: null },
    ]);

    expect(total).toEqual({
      totalCents: null,
      isExact: false,
      fromCents: null,
    });
  });

  it('treats an empty cart as not exact with no total', () => {
    const total = computeCartTotal([]);

    expect(total).toEqual({
      totalCents: null,
      isExact: false,
      fromCents: null,
    });
  });

  it('is exact for a single priced line', () => {
    const total = computeCartTotal([{ priceCents: 4200 }]);

    expect(total).toEqual({
      totalCents: 4200,
      isExact: true,
      fromCents: 4200,
    });
  });

  it('includes a zero-priced (free) line in an exact total', () => {
    const total = computeCartTotal([{ priceCents: 0 }, { priceCents: 3000 }]);

    expect(total).toEqual({
      totalCents: 3000,
      isExact: true,
      fromCents: 3000,
    });
  });
});
