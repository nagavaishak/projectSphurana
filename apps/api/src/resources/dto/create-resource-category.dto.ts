import { createResourceCategorySchema } from '@borradh-workspace/features/resources';
import { createZodDto } from 'nestjs-zod';

/**
 * Body for POST /resources/categories.
 *
 * `organizationId` is server-injected from `@ActiveOrganization()` and is not
 * part of the wire contract — a client must never be able to name the org it
 * writes into.
 */
export class CreateResourceCategoryDto extends createZodDto(
  createResourceCategorySchema.omit({ organizationId: true })
) {}
