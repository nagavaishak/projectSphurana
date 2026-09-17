/**
 * The medication catalogue — FIXTURE, modelled on what a clinic actually needs
 * to stock an injectable, and on how Decoda groups it.
 *
 * ## Why this is a CATALOGUE concept, not a patient one
 *
 * "Medications" sits under Items/Catalogue beside Products and Services, not
 * under the patient. It is the org's stock: a thing with a unit, a price per
 * unit, and a quantity at each location that goes DOWN when it is administered.
 *
 * ## How close is `product` already?
 *
 *   name, brand, category, supplier   product.{name,brandId,categoryId,supplierId}
 *   price                             product.{supplyPriceCents,retailPriceCents}
 *   stock per location                product_stock(product_id, location_id, quantity)
 *   low stock / reorder               product.{lowStockLevel,reorderQuantity}
 *   not sold at the till              product.retailEnabled = false
 *
 * Four things are missing, and only four:
 *
 *   unit      there is NO unit-of-measure column. A product is implicitly
 *             "each". A medication is Units, Vials, Syringes or Troches, and
 *             the unit is what the price and the stock count are IN.
 *   lot       batch number + expiry. Not on product, and it cannot go there:
 *             one product has MANY lots with different expiries, so it is a
 *             child table — product_lot(productId, locationId, lot, expiry,
 *             quantity) — and for a medication that is where quantity really
 *             lives.
 *   template  Decoda links a medication to a treatment template so recording
 *             the treatment pre-fills the dose.
 *   lastUsed  derivable, but only once treatments are recorded at all.
 *
 * RECOMMENDATION: extend `product` rather than add a `medication` table.
 * Inventory, suppliers, stock orders, stock takes and low-stock alerts all
 * already work against products; a parallel table means a second copy of every
 * one of them. Add `unit` and an `is_medication` flag to product, and add
 * `product_lot` — which traceability requires regardless of how this is
 * modelled.
 */

export type MedicationUnit = 'Units' | 'Vials' | 'Syringes' | 'ml';

export type Medication = {
  id: string;
  name: string;
  brand: string | null;
  unit: MedicationUnit;
  /** Price per ONE of `unit`, in cents. */
  pricePerUnitCents: number;
  category: string;
  /** Stock at THIS location, counted in `unit`. */
  stock: number;
  /** Lots held, newest first. Traceability lives here. */
  lots: { lot: string; expiry: string; quantity: number }[];
};

export const MEDICATIONS: Medication[] = [
  {
    id: 'm1',
    name: 'Botulinum toxin type A',
    brand: 'Azzalure',
    unit: 'Units',
    pricePerUnitCents: 600,
    category: 'Injectables',
    stock: 508,
    lots: [
      { lot: 'AZ4471-B', expiry: 'Mar 2027', quantity: 300 },
      { lot: 'AZ4390-A', expiry: 'Nov 2026', quantity: 208 },
    ],
  },
  {
    id: 'm2',
    name: 'Botulinum toxin type A',
    brand: 'Botox',
    unit: 'Units',
    pricePerUnitCents: 650,
    category: 'Injectables',
    stock: 398,
    lots: [{ lot: 'BX9921-C', expiry: 'Jul 2027', quantity: 398 }],
  },
  {
    id: 'm3',
    name: 'Hyaluronic acid filler',
    brand: 'Juvederm Ultra XC',
    unit: 'Syringes',
    pricePerUnitCents: 30_000,
    category: 'Injectables',
    stock: 14,
    lots: [{ lot: 'JV3310-F', expiry: 'Jan 2028', quantity: 14 }],
  },
  {
    id: 'm4',
    /**
     * The reversal agent for HA filler. Stocked because a vascular occlusion
     * is an emergency — which is also why its expiry matters more than most.
     */
    name: 'Hyaluronidase',
    brand: 'Hyalase',
    unit: 'Vials',
    pricePerUnitCents: 4500,
    category: 'Injectables',
    stock: 6,
    lots: [{ lot: 'HY2201-A', expiry: 'Sep 2026', quantity: 6 }],
  },
  {
    id: 'm5',
    name: 'Lidocaine 2%',
    brand: null,
    unit: 'ml',
    pricePerUnitCents: 120,
    category: 'Anaesthetic',
    stock: 240,
    lots: [{ lot: 'LD8874-D', expiry: 'Apr 2027', quantity: 240 }],
  },
];

export function medicationLabel(m: Medication) {
  return m.brand ? `${m.brand} — ${m.name}` : m.name;
}

export function formatEuro(cents: number) {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);
}
