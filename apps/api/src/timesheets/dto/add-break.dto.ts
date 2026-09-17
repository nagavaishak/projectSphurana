import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// API-layer schema: one endpoint toggles break start/end (contract §3.10
// AddBreakDto); routes to the startBreak / endBreak feature services.
const addBreakSchema = z.object({
  type: z.enum(['start', 'end']),
  at: z.coerce.date().optional(),
});

export class AddBreakDto extends createZodDto(addBreakSchema) {}
