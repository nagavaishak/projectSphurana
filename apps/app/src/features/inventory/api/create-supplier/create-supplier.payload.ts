import { createSupplierRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';
import type { CreateSupplierIntent } from './create-supplier.input';

/**
 * The single wire body for POST /suppliers.
 *
 * The schema is NOT declared here — it is the canonical
 * {@link createSupplierRequestSchema} from `@borradh-workspace/contracts`, the
 * same object the backend's `createSupplierSchema` extends with
 * `organizationId` and the API DTO validates against. It is `.strict()`, so an
 * extra or missing field is a parse/type error, never a silent strip.
 */
export const createSupplierBodySchema = createSupplierRequestSchema;

export type CreateSupplierBody = z.infer<typeof createSupplierBodySchema>;

/**
 * Assemble the supplier wire body from intent. The ONLY place a supplier create
 * body is built — the dialog and the inline-create picker both route here, so a
 * missing description always coalesces to `null` identically.
 */
export function buildCreateSupplierPayload(
  intent: CreateSupplierIntent
): CreateSupplierBody {
  const description = intent.description?.trim();
  return createSupplierBodySchema.parse({
    name: intent.name.trim(),
    description: description ? description : null,
  });
}
