import { parseMajorToCents } from '@/lib/org-currency';
import { createProductRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';
import type { ProductWriteIntent } from './create-product.input';

/**
 * The single wire body for both POST /products and PUT /products/:id.
 *
 * The schema is NOT declared here — it is the canonical
 * {@link createProductRequestSchema} from `@borradh-workspace/contracts`, the
 * same object the backend's `createProductSchema` extends with
 * `organizationId` and the API DTO validates against. There is no mirror left
 * to drift.
 *
 * Why the CREATE contract serves both verbs: `updateProductRequestBase` is
 * strictly looser (every field optional, `images`/`skus` additionally
 * nullable), so a body that satisfies create satisfies update too. Validating
 * the writer against the tighter of the pair means an edit can never send a
 * body the create endpoint would have rejected. The only update-only field,
 * `isActive`, is not something any form surface sets.
 *
 * It is `.strict()`, so an extra or missing field is a parse/type error, never
 * a silent strip. The contract also carries real value constraints the old
 * hand-written mirror did not — prices are non-negative INTEGER cents,
 * `measureAmount` must be POSITIVE, `reorderQuantity` must be `>= 1`, and the
 * id fields are `.min(1)`. Where the form's blank value is `''` rather than
 * `null` that would turn a server 400 into a client-side throw, so the builder
 * normalises those below; the remaining cases (a typed `0` measure amount or
 * reorder quantity) were always invalid and now simply fail earlier.
 */
export const productWriteBodySchema = createProductRequestSchema;

export type ProductWriteBody = z.infer<typeof productWriteBodySchema>;

/**
 * A blank id from a "None" option is ABSENT on the wire, not an empty string —
 * the contract's `.min(1)` would otherwise reject it.
 */
const orNull = (value: string | null): string | null =>
  value === '' ? null : value;

/**
 * Assemble the product wire body from form intent. This is the ONLY place the
 * body is built, so a desktop and a mobile surface can never diverge. Every
 * derivation (price strings → cents, measure amount, conditional reorder /
 * low-stock fields gated on trackStock, commission gated on retail) lives here.
 */
export function buildProductWritePayload(
  intent: ProductWriteIntent
): ProductWriteBody {
  const supplyPriceCents = parseMajorToCents(intent.supplyRaw);
  const retailPriceCents = intent.retailEnabled
    ? parseMajorToCents(intent.retailRaw)
    : null;
  const measureAmount = intent.measureAmount.trim()
    ? Number.parseFloat(intent.measureAmount)
    : null;
  const lowStockLevel =
    intent.trackStock && intent.lowStockLevel.trim()
      ? Number.parseInt(intent.lowStockLevel, 10)
      : null;
  const reorderQuantity =
    intent.trackStock && intent.reorderQuantity.trim()
      ? Number.parseInt(intent.reorderQuantity, 10)
      : null;

  return productWriteBodySchema.parse({
    name: intent.name.trim(),
    images: intent.images.filter(Boolean),
    barcode: intent.barcode.trim() || null,
    brandId: orNull(intent.brandId),
    measureUnit: intent.measureUnit,
    measureAmount,
    description: intent.description.trim() || null,
    categoryId: orNull(intent.categoryId),
    supplyPriceCents,
    retailEnabled: intent.retailEnabled && !intent.isMedication,
    isMedication: intent.isMedication,
    // Mirror the two CHECK constraints so the UI never posts a row the
    // database will refuse.
    onlineEnabled:
      intent.onlineEnabled && intent.retailEnabled && !intent.isMedication,
    shippable: intent.shippable,
    retailPriceCents,
    taxCode: intent.taxCode?.trim() || null,
    teamMemberCommissionEnabled:
      intent.retailEnabled && intent.teamMemberCommissionEnabled,
    skus: intent.skus.filter(Boolean),
    supplierId: orNull(intent.supplierId),
    trackStock: intent.trackStock,
    lowStockLevel,
    reorderQuantity,
    lowStockNotify: intent.trackStock && intent.lowStockNotify,
  });
}
