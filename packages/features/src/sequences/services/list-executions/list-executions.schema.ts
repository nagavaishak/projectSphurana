import { sequenceExecutionStatusValues } from '@borradh-workspace/labels';
import { z } from 'zod';

export const listExecutionsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  sequenceId: z.string().optional(),
  status: z.enum(sequenceExecutionStatusValues).optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

// Input type (what callers provide - optional fields are optional)
export type ListExecutionsInput = z.input<typeof listExecutionsSchema>;

// Output type (after defaults applied - all fields present)
export type ListExecutionsParsed = z.output<typeof listExecutionsSchema>;
