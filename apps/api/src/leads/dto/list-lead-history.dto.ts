import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const listLeadHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export class ListLeadHistoryDto extends createZodDto(
  listLeadHistoryQuerySchema
) {}
