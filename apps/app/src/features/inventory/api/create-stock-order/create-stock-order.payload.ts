import { parseMajorToCents } from '@/lib/org-currency';
import { createStockOrderRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';
import type { CreateStockOrderIntent } from './create-stock-order.input';

/**
 * The single wire body for POST /stock-orders.
 *
 * The schema is NOT declared here — it is the canonical
 * {@link createStockOrderRequestSchema} from `@borradh-workspace/contracts`,
 * the same object the backend's `createStockOrderSchema` extends with
 * `organizationId` + `createdById` and the API DTO validates against. There is
 * no mirror left to drift.
 *
 * It is `.strict()`, so an extra or missing field is a parse/type error, never
 * a silent strip. Two differences from the hand-written mirror it replaces:
 * `expectedByDate` is `z.coerce.date()` (still accepts the `Date` this builder
 * holds, and additionally the ISO string it becomes on the wire), and the
 * per-item constraints the server always enforced — `quantity >= 1`,
 * `unitCostCents` a non-negative integer, `productId` non-empty — are now
 * checked here too. The builder's own guards below already reject those cases
 * with friendlier messages, so the contract is a backstop rather than the first
 * line of defence.
 */
export const createStockOrderBodySchema = createStockOrderRequestSchema;

export type CreateStockOrderBody = z.infer<typeof createStockOrderBodySchema>;

/**
 * A blank id from a "None" option is ABSENT on the wire, not an empty string —
 * the contract's `.min(1)` would otherwise reject it.
 */
const orNull = (value: string | null): string | null =>
  value === '' ? null : value;

/**
 * Assemble the stock-order wire body from form intent. This is the ONLY place
 * the body is built. Line-item quantities/costs are parsed, empty product rows
 * dropped, and fees converted (currency → cents, percent → basis points, so
 * 2.5% becomes 250). Invalid input throws with the same message the form
 * previously toasted; the mutation's onError surfaces it.
 */
export function buildCreateStockOrderPayload(
  intent: CreateStockOrderIntent
): CreateStockOrderBody {
  const items = intent.itemRows
    .filter((row) => row.productId)
    .map((row) => ({
      productId: row.productId as string,
      quantity: Number.parseInt(row.quantity, 10),
      unitCostCents: parseMajorToCents(row.costRaw) ?? 0,
    }));

  if (items.length === 0) {
    throw new Error('Add at least one product');
  }
  if (items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 1)) {
    throw new Error('Every line needs a quantity of 1 or more');
  }

  const fees: CreateStockOrderBody['fees'] = [];
  for (const fee of intent.feeRows) {
    const name = fee.name.trim();
    if (!name) {
      throw new Error('Every fee needs a name');
    }
    // Currency → cents; percent → basis points (2.5% → 250).
    const value =
      fee.type === 'currency'
        ? (parseMajorToCents(fee.valueRaw) ?? 0)
        : Math.round(Number.parseFloat(fee.valueRaw.replace(',', '.')) * 100);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Enter a valid value for "${name}"`);
    }
    fees.push({ name, type: fee.type, value });
  }

  return createStockOrderBodySchema.parse({
    supplierId: orNull(intent.supplierId),
    locationId: orNull(intent.locationId),
    expectedByDate: intent.expectedByDate,
    notes: intent.notes.trim() || null,
    items,
    fees,
  });
}
