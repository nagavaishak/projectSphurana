import { defineCoverage } from '../coverage.types.js';

/**
 * PRODUCT-CATEGORIES — 4 endpoints, 0 tools. The sibling taxonomy to
 * product-brands: the category each retail product is filed under, and the
 * grouping that product lists and stock reports are cut by.
 *
 * Same decision, for the same reason. The read is the vocabulary needed to
 * interpret a product list and is parked as `undecided`; the writes are held
 * back because a curated set of category names is exactly the kind of small
 * controlled vocabulary a model degrades by adding to it, and because renaming
 * or deleting one re-files every product underneath in a single call.
 */
export const productCategoriesCoverage = defineCoverage('product-categories', {
  // ---- reads -------------------------------------------------------------
  'GET /product-categories': { undecided: 'ENG-CLAIRE-PRODUCT-CATEGORIES' },

  // ---- writes ------------------------------------------------------------
  'POST /product-categories': {
    notExposed:
      'Category names are a small controlled vocabulary the owner curates. Letting a model add to it produces overlapping categories that quietly split stock reporting across near-identical buckets.',
  },
  'PUT /product-categories/:id': {
    notExposed:
      'Renaming a category relabels every product filed under it in one call — a catalogue-wide change, not a single-row edit.',
  },
  'DELETE /product-categories/:id': {
    notExposed:
      'Removes the grouping that products and stock reports hang off, unfiling everything underneath. The owner needs to see the affected products first.',
  },
});
