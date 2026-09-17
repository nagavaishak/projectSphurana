import { resourceCategoryKindValues } from '@borradh-workspace/database';
import { z } from 'zod';
import {
  resourceDescriptionSchema,
  resourceNameSchema,
  sortOrderSchema,
} from '../_shared/index.js';

export const updateResourceCategorySchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  name: resourceNameSchema.optional(),
  kind: z.enum(resourceCategoryKindValues).optional(),
  description: resourceDescriptionSchema.nullable().optional(),
  sortOrder: sortOrderSchema.optional(),
  isActive: z.boolean().optional(),
});

export type UpdateResourceCategoryInput = z.infer<
  typeof updateResourceCategorySchema
>;
