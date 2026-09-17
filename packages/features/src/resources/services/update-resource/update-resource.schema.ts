import { z } from 'zod';
import {
  resourceCapacitySchema,
  resourceColorSchema,
  resourceDescriptionSchema,
  resourceNameSchema,
  resourceSpecsSchema,
  resourceWorkingHoursSchema,
  sortOrderSchema,
} from '../_shared/index.js';

export const updateResourceSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  categoryId: z.string().min(1).optional(),
  name: resourceNameSchema.optional(),
  description: resourceDescriptionSchema.nullable().optional(),
  color: resourceColorSchema.nullable().optional(),
  photo: z.string().nullable().optional(),
  capacity: resourceCapacitySchema.optional(),
  specs: resourceSpecsSchema.nullable().optional(),
  workingHours: resourceWorkingHoursSchema.nullable().optional(),
  locationId: z.string().min(1).nullable().optional(),
  sortOrder: sortOrderSchema.optional(),
  isActive: z.boolean().optional(),
});

export type UpdateResourceInput = z.infer<typeof updateResourceSchema>;
