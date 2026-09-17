import { resourceCategoryKindValues } from '@borradh-workspace/database';
import { z } from 'zod';
import {
  resourceDescriptionSchema,
  resourceNameSchema,
  sortOrderSchema,
} from '../_shared/index.js';

export const createResourceCategorySchema = z.object({
  organizationId: z.string().min(1),
  name: resourceNameSchema,
  /** UI copy/defaults only — the scheduling engine treats every kind alike. */
  kind: z.enum(resourceCategoryKindValues).optional().default('room'),
  // Nullable for the same reason as create-resource: a form sends `null`
  // for an empty optional field, and update-resource-category already allows it.
  description: resourceDescriptionSchema.nullable().optional(),
  sortOrder: sortOrderSchema.optional(),
});

export type CreateResourceCategoryInput = z.input<
  typeof createResourceCategorySchema
>;
