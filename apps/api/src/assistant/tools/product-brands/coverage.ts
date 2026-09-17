import { defineCoverage } from '../coverage.types.js';

/**
 * PRODUCT-BRANDS — 4 endpoints, 0 tools. One of the two taxonomies hanging off
 * the retail catalogue (the other is product-categories): a flat list of brand
 * names that products are filed under and filtered by.
 *
 * The list read is parked as `undecided` — it is the vocabulary you need to
 * make sense of a product list, and there is nothing sensitive in a set of brand
 * names. The writes are refused as a matter of shape rather than danger:
 * taxonomy is a small, stable set that the owner curates, and a model that can
 * mint terms will invent near-duplicates ("Olaplex", "OLAPLEX", "Olaplex Pro")
 * that fragment every filter and report built on the field.
 */
export const productBrandsCoverage = defineCoverage('product-brands', {
  // ---- reads -------------------------------------------------------------
  'GET /product-brands': { undecided: 'ENG-CLAIRE-PRODUCT-BRANDS' },

  // ---- writes ------------------------------------------------------------
  'POST /product-brands': {
    notExposed:
      'Taxonomy is a small curated vocabulary. A model free to mint brand names produces near-duplicates that fragment product filtering and every report grouped by brand — and nobody notices until the numbers stop adding up.',
  },
  'PUT /product-brands/:id': {
    notExposed:
      'Renaming a brand changes the label on every product filed under it at once. It is a catalogue-wide edit disguised as a one-field update.',
  },
  'DELETE /product-brands/:id': {
    notExposed:
      'Deleting a brand orphans or unfiles every product pointing at it. The owner needs to see what is attached before making that call.',
  },
});
