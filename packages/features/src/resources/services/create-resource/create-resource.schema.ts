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

export const createResourceSchema = z.object({
  organizationId: z.string().min(1),
  categoryId: z.string().min(1),
  name: resourceNameSchema,
  // Every nullable DB column accepts an explicit `null` as well as absence.
  // A form serialising its empty fields sends `null`, not `undefined` — and
  // `.optional()` alone rejects that, which is a 400 on a perfectly ordinary
  // "create a room with no colour". `update-resource.schema.ts` already models
  // all of these as `.nullable().optional()`; create must agree, or a shape the
  // API accepts on edit is refused on create.
  description: resourceDescriptionSchema.nullable().optional(),
  color: resourceColorSchema.nullable().optional(),
  photo: z.string().nullable().optional(),
  capacity: resourceCapacitySchema.optional().default(1),
  specs: resourceSpecsSchema.nullable().optional(),
  /** Null/absent = always available (inherits the clinic's own opening hours). */
  workingHours: resourceWorkingHoursSchema.nullable().optional(),
  /** Null/absent = available at every location. */
  locationId: z.string().min(1).nullable().optional(),
  sortOrder: sortOrderSchema.optional(),
});

export type CreateResourceInput = z.input<typeof createResourceSchema>;
