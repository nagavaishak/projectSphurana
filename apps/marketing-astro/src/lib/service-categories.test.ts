import { describe, expect, it } from 'vitest';
import { serviceCategoryChips } from './service-categories';

describe('serviceCategoryChips', () => {
  it('returns no chips when nothing is categorised', () => {
    // The estate's common case — every service null. A "Treatment" chip here
    // would match all of them and filter nothing.
    expect(
      serviceCategoryChips([
        { category: null },
        { category: null },
        { category: null },
      ])
    ).toEqual([]);
  });

  it('returns no chips when ONE category holds every service', () => {
    expect(
      serviceCategoryChips([{ category: 'Skin' }, { category: 'Skin' }])
    ).toEqual([]);
  });

  it('returns the single chip when some services sit outside it', () => {
    // "All" vs "Skin" is a real choice, so the row earns its place.
    expect(
      serviceCategoryChips([{ category: 'Skin' }, { category: null }])
    ).toEqual(['Skin']);
  });

  it('returns every category once, in catalogue order', () => {
    expect(
      serviceCategoryChips([
        { category: 'Injectables' },
        { category: 'Skin' },
        { category: 'Injectables' },
        { category: 'Laser' },
      ])
    ).toEqual(['Injectables', 'Skin', 'Laser']);
  });

  it('treats an empty string like no category', () => {
    expect(serviceCategoryChips([{ category: '' }, { category: '' }])).toEqual(
      []
    );
  });

  it('handles an absent category key', () => {
    expect(serviceCategoryChips([{}, { category: 'Skin' }])).toEqual(['Skin']);
  });

  it('returns no chips for an empty catalogue', () => {
    expect(serviceCategoryChips([])).toEqual([]);
  });
});
