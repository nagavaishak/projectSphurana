import { createProductBrandRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';
import type { CreateProductBrandIntent } from './create-product-brand.input';

/**
 * The single wire body for POST /product-brands.
 *
 * The schema is NOT declared here — it is the canonical
 * {@link createProductBrandRequestSchema} from `@borradh-workspace/contracts`,
 * the same object the backend's `createProductBrandSchema` extends with
 * `organizationId` and the API DTO validates against. There is no mirror left
 * to drift.
 *
 * It is `.strict()`, so an extra or missing field is a parse/type error, never
 * a silent strip.
 */
export const createProductBrandBodySchema = createProductBrandRequestSchema;

export type CreateProductBrandBody = z.infer<
  typeof createProductBrandBodySchema
>;

/**
 * Assemble the brand wire body from intent. The ONLY place a brand create body
 * is built — dialog and inline-create picker both route here, so a missing
 * description always coalesces to `null` identically.
 */
export function buildCreateProductBrandPayload(
  intent: CreateProductBrandIntent
): CreateProductBrandBody {
  const description = intent.description?.trim();
  return createProductBrandBodySchema.parse({
    name: intent.name.trim(),
    description: description ? description : null,
  });
}
